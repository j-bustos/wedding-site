interface ApiPlusOne {
  id: number;
  name: string;
  is_named: boolean;
}

interface ApiGuest {
  id: number;
  name: string;
  is_named: boolean;
  has_plus_one: boolean;
  plus_one?: ApiPlusOne;
}

interface Household {
  id: number;
  label: string;
  max_party: number;
  already_responded: boolean;
  guests: ApiGuest[];
  open_plus_one_seats: number;
}

interface PlusOneResponseState {
  attending: boolean | null;
  name: string;
}

interface GuestResponseState {
  attending: boolean | null;
  songRequest: string;
  /** Only present when this guest has an attributed plus-one seat. */
  plusOne?: PlusOneResponseState;
}

/** A generic, unattributed household plus-one seat. */
interface PlusOneState {
  name: string;
}

type StepName = 'find' | 'confirm' | 'ambiguous' | 'not-found' | 'respond' | 'review' | 'success';

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | Element, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEventDateTime(): string {
  const date = new Date('2026-12-18T15:00:00-06:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
}

/** An attributed plus-one is only ever "attending" if both it AND its
 * sponsoring guest said yes — computed fresh wherever needed rather than
 * stored, so there's one place this rule lives. */
function effectivePlusOneAttending(r: GuestResponseState): boolean {
  return !!r.attending && r.plusOne?.attending === true;
}

function initRsvpForm(root: HTMLElement) {
  const apiBase = root.dataset.apiBase ?? '';
  const turnstileSiteKey = root.dataset.turnstileSiteKey ?? '';
  const contactPhone = root.dataset.contactPhone || '';
  const contactEmail = root.dataset.contactEmail || '';

  const liveRegion = root.querySelector<HTMLElement>('#rsvpLive');
  const steps = new Map<StepName, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-step]').forEach((el) => {
    steps.set(el.dataset.step as StepName, el);
  });

  let household: Household | null = null;
  let responses = new Map<number, GuestResponseState>();
  let plusOnes: PlusOneState[] = [];
  let turnstileToken = '';
  let turnstileWidgetId: string | undefined;
  let submitting = false;

  function announce(text: string) {
    if (!liveRegion) return;
    liveRegion.textContent = '';
    // Force screen readers to re-announce even if the text is identical to
    // the previous step's announcement.
    window.setTimeout(() => {
      liveRegion.textContent = text;
    }, 30);
  }

  function scrollStepIntoView(target: HTMLElement) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function showStep(name: StepName, announceText?: string, moveFocus = true) {
    steps.forEach((el, key) => {
      const active = key === name;
      el.hidden = !active;
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    const target = steps.get(name);
    // Only move focus/scroll on step *transitions* triggered by user action —
    // not on initial mount, where focusing/scrolling into the RSVP section
    // would yank the page's scroll position on every load.
    if (target && moveFocus) {
      const heading = target.querySelector<HTMLElement>('h3, h4, legend, [data-step-heading]');
      const focusTarget = heading ?? target.querySelector<HTMLElement>('input, button, textarea') ?? target;
      focusTarget.setAttribute('tabindex', focusTarget.hasAttribute('tabindex') ? focusTarget.getAttribute('tabindex')! : '-1');
      focusTarget.focus({ preventScroll: true });
      // The previous step may have been much taller than this one, so the
      // viewport needs to be repositioned to the new step's top rather than
      // left wherever it happened to be scrolled.
      scrollStepIntoView(heading ?? target);
    }
    if (announceText) announce(announceText);
  }

  function contactFallbackText(): string {
    return 'contact us and we will be glad to help.';
  }

  // ---- Turnstile: loaded lazily, only once the RSVP form nears the viewport ----
  function ensureTurnstileLoaded(onReady: () => void) {
    if (!turnstileSiteKey) {
      onReady();
      return;
    }
    if (window.turnstile) {
      onReady();
      return;
    }
    const existing = document.querySelector('script[data-turnstile]');
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.addEventListener('load', onReady, { once: true });
    document.head.appendChild(script);
  }

  // Whichever action button is currently on-screen (the 'find' step's
  // #rsvpFindBtn, or the dynamically-rendered review step's
  // #rsvpSubmitBtn) should only be clickable while a live token is held —
  // otherwise the request it fires is guaranteed to fail verification.
  function setActionButtonsEnabled(enabled: boolean) {
    const findBtnEl = root.querySelector<HTMLButtonElement>('#rsvpFindBtn');
    if (findBtnEl) findBtnEl.disabled = !enabled;
    const submitBtnEl = root.querySelector<HTMLButtonElement>('#rsvpSubmitBtn');
    if (submitBtnEl && !submitting) submitBtnEl.disabled = !enabled;
    const verifyHintEl = root.querySelector<HTMLElement>('#rsvpVerifyHint');
    if (verifyHintEl) verifyHintEl.hidden = enabled;
  }

  // Turnstile tokens are single-use — Cloudflare invalidates a token the
  // moment it's verified server-side. Every request that sends
  // turnstileToken (lookup, then rsvp submit) must be followed by this, or
  // the *next* request silently fails verification instead of succeeding.
  // The widget re-verifies in the background (usually near-instant), so the
  // disabled window is normally too brief to notice — but the guard in
  // handleSubmit below covers the case where a user reaches "Submit" before
  // it finishes.
  function resetTurnstile() {
    if (!turnstileSiteKey) return; // dev bypass token needs no refresh
    turnstileToken = '';
    setActionButtonsEnabled(false);
    if (window.turnstile && turnstileWidgetId !== undefined) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }

  function renderTurnstileWidget() {
    const container = root.querySelector<HTMLElement>('#rsvpTurnstile');
    if (!container) return;

    if (!turnstileSiteKey) {
      container.textContent = '';
      turnstileToken = 'dev-no-turnstile-configured';
      setActionButtonsEnabled(true);
      return;
    }

    ensureTurnstileLoaded(() => {
      if (!window.turnstile) return;
      turnstileWidgetId = window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          turnstileToken = token;
          setActionButtonsEnabled(true);
        },
        'expired-callback': () => {
          turnstileToken = '';
          setActionButtonsEnabled(false);
        },
        'error-callback': () => {
          turnstileToken = '';
          setActionButtonsEnabled(false);
        },
      });
    });
  }

  const findSection = steps.get('find');
  if (findSection) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          renderTurnstileWidget();
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(root);
  }

  // ---- Step 1: find ----
  const nameInput = root.querySelector<HTMLInputElement>('#rsvpNameInput');
  const findBtn = root.querySelector<HTMLButtonElement>('#rsvpFindBtn');
  const findError = root.querySelector<HTMLElement>('#rsvpFindError');

  async function handleFind() {
    if (!nameInput || !nameInput.value.trim()) return;
    if (findError) {
      findError.hidden = true;
      findError.textContent = '';
    }
    if (findBtn) {
      findBtn.disabled = true;
      findBtn.textContent = 'Searching…';
    }

    try {
      const res = await fetch(`${apiBase}/api/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.value.trim(), turnstileToken }),
      });
      const data = await res.json();

      if (res.status === 429) {
        throw new Error(data.message || 'Too many attempts. Please wait a few minutes and try again.');
      }
      if (data.status === 'error') {
        throw new Error(data.message || `We could not reach the server. Please try again, or ${contactFallbackText()}`);
      }

      if (data.status === 'found') {
        household = data.household as Household;
        responses = new Map(
          household.guests.map((g) => [
            g.id,
            {
              attending: null,
              songRequest: '',
              plusOne: g.has_plus_one ? { attending: null, name: g.plus_one?.is_named ? g.plus_one.name : '' } : undefined,
            },
          ])
        );
        plusOnes = Array.from({ length: household.open_plus_one_seats }, () => ({ name: '' }));
        renderConfirmStep();
        showStep('confirm', `Found ${household.label}.`);
      } else if (data.status === 'ambiguous') {
        renderAmbiguousStep(data.guests as string[]);
        showStep('ambiguous', 'More than one guest matches that name. Please enter your full name as shown.');
      } else {
        renderNotFoundStep();
        showStep('not-found', 'We could not find that name.');
      }
    } catch (err) {
      if (findError) {
        findError.hidden = false;
        findError.textContent =
          err instanceof Error
            ? err.message
            : `We could not reach the server. Please try again, or ${contactFallbackText()}`;
      }
    } finally {
      if (findBtn) findBtn.textContent = 'Find my invitation';
      resetTurnstile();
    }
  }

  findBtn?.addEventListener('click', handleFind);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFind();
    }
  });

  // ---- Step 2: confirm ----
  function renderConfirmStep() {
    const section = steps.get('confirm');
    if (!section || !household) return;
    const alreadyRespondedBanner = household.already_responded
      ? `<p class="rsvp-banner-note">You have already replied. Submitting again will update your response.</p>`
      : '';
    section.innerHTML = `
      <h3 data-step-heading>${escapeHtml(household.label)}</h3>
      ${alreadyRespondedBanner}
      <ul class="rsvp-guest-preview">
        ${household.guests.map((g) => `<li>${escapeHtml(g.name)}${g.has_plus_one ? ` <span class="rsvp-guest-preview-tag">${g.plus_one?.is_named && g.plus_one.name ? `+ ${escapeHtml(g.plus_one.name)}` : '+1'}</span>` : ''}</li>`).join('')}
      </ul>
      <button type="button" class="btn-primary" data-action="continue-to-respond">Continue</button>
    `;
    section
      .querySelector('[data-action="continue-to-respond"]')
      ?.addEventListener('click', () => {
        renderRespondStep();
        showStep('respond', 'Let us know who can make it.');
      });
  }

  // ---- Step 2b: ambiguous ----
  function renderAmbiguousStep(guestNames: string[]) {
    const section = steps.get('ambiguous');
    if (!section) return;
    section.innerHTML = `
      <h3 data-step-heading>Please confirm your name</h3>
      <p class="rsvp-hint">More than one guest matches that name. Please enter your full name as it appears below and try again.</p>
      <ul class="rsvp-guest-preview">${guestNames.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
      <button type="button" class="btn-secondary" data-action="retry">Try again</button>
    `;
    section.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      showStep('find');
      nameInput?.focus();
    });
  }

  // ---- Step 2c: not found ----
  function renderNotFoundStep() {
    const section = steps.get('not-found');
    if (!section) return;
    section.innerHTML = `
      <h3 data-step-heading>We could not find that name</h3>
      <p class="rsvp-hint">Please try the name you go by, or the name of another guest in your party. If we still cannot find you, please ${contactEmail ? `<a href="mailto:${escapeHtml(contactEmail)}">contact us</a>` : 'contact us'} and we will be glad to help.</p>
      <button type="button" class="btn-secondary" data-action="retry">Try another name</button>
    `;
    section.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      showStep('find');
      nameInput?.focus();
    });
  }

  // ---- Step 3: respond ----
  function renderRespondStep() {
    const section = steps.get('respond');
    if (!section || !household) return;

    const guestFields = household.guests
      .map((g) => {
        const mainField = `
      <fieldset class="rsvp-guest-fieldset" data-guest-id="${g.id}">
        <legend>${escapeHtml(g.name)}</legend>
        <label class="rsvp-radio"><input type="radio" name="attend-${g.id}" value="yes" /> Joyfully accepts</label>
        <label class="rsvp-radio"><input type="radio" name="attend-${g.id}" value="no" /> Regretfully declines</label>
        <div class="rsvp-guest-extra" data-guest-extra="${g.id}" hidden>
          <label>Song request (optional)<input type="text" data-field="song" data-guest="${g.id}" /></label>
        </div>
      </fieldset>`;

        if (!g.has_plus_one) return mainField;

        const state = responses.get(g.id);
        const prefillName = state?.plusOne?.name ?? '';
        const plusOneRow = `
      <div class="rsvp-plusone-row" data-plusone-for="${g.id}">
        <p class="rsvp-plusone-label">Plus one for ${escapeHtml(g.name)}</p>
        <div data-plusone-controls="${g.id}">
          <label class="rsvp-radio"><input type="radio" name="plusone-attend-${g.id}" value="yes" /> Joyfully accepts</label>
          <label class="rsvp-radio"><input type="radio" name="plusone-attend-${g.id}" value="no" /> Regretfully declines</label>
          <div class="rsvp-plusone-extra" data-plusone-extra="${g.id}" hidden>
            <label>Plus one's full name<input type="text" data-plusone-fullname="${g.id}" value="${escapeHtml(prefillName)}" /></label>
          </div>
        </div>
        <p class="rsvp-plusone-declined-note" data-plusone-declined-note="${g.id}" hidden>Plus one seat also declined.</p>
      </div>`;
        return mainField + plusOneRow;
      })
      .join('');

    const plusOneFields = plusOnes
      .map(
        (_, i) => `
      <fieldset class="rsvp-guest-fieldset" data-plusone-index="${i}">
        <legend>Additional guest ${i + 1} (optional)</legend>
        <label>Name<input type="text" data-plusone-name="${i}" /></label>
      </fieldset>`
      )
      .join('');

    const alreadyRespondedBanner = household.already_responded
      ? `<p class="rsvp-banner-note">You have already replied. Submitting again will update your response.</p>`
      : '';

    section.innerHTML = `
      <h3 data-step-heading>Who can make it?</h3>
      ${alreadyRespondedBanner}
      ${guestFields}
      ${plusOneFields}
      <p class="rsvp-error" id="rsvpRespondError" hidden></p>
      <button type="button" class="btn-primary" data-action="review">Review your RSVP</button>
    `;

    section.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="attend-"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const fieldset = radio.closest('fieldset');
        const guestId = Number(fieldset?.dataset.guestId);
        const extra = section.querySelector<HTMLElement>(`[data-guest-extra="${guestId}"]`);
        const attending = radio.value === 'yes';
        if (extra) extra.hidden = !attending;
        const state = responses.get(guestId);
        if (state) state.attending = attending;

        if (state?.plusOne) {
          const controls = section.querySelector<HTMLElement>(`[data-plusone-controls="${guestId}"]`);
          const note = section.querySelector<HTMLElement>(`[data-plusone-declined-note="${guestId}"]`);
          if (controls) controls.hidden = !attending;
          if (note) note.hidden = attending;
        }
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="plusone-attend-"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const row = radio.closest<HTMLElement>('[data-plusone-for]');
        const guestId = Number(row?.dataset.plusoneFor);
        const state = responses.get(guestId);
        if (!state?.plusOne) return;
        const attending = radio.value === 'yes';
        state.plusOne.attending = attending;
        const extra = section.querySelector<HTMLElement>(`[data-plusone-extra="${guestId}"]`);
        if (extra) extra.hidden = !attending;
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[data-plusone-fullname]').forEach((input) => {
      input.addEventListener('input', () => {
        const guestId = Number(input.dataset.plusoneFullname);
        const state = responses.get(guestId);
        if (state?.plusOne) state.plusOne.name = input.value;
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const guestId = Number(input.dataset.guest);
        const state = responses.get(guestId);
        if (!state) return;
        if (input.dataset.field === 'song') state.songRequest = input.value;
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[data-plusone-name]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.plusoneName);
        plusOnes[i].name = input.value;
      });
    });

    section.querySelector('[data-action="review"]')?.addEventListener('click', () => {
      const respondError = section.querySelector<HTMLElement>('#rsvpRespondError');
      const unanswered = [...responses.values()].some((r) => {
        if (r.attending === null) return true;
        // Only force a plus-one answer when their sponsor is actually attending —
        // a declined sponsor auto-declines the seat, nothing left to ask.
        if (r.attending && r.plusOne && r.plusOne.attending === null) return true;
        return false;
      });
      if (unanswered) {
        if (respondError) {
          respondError.hidden = false;
          respondError.textContent = 'Please respond for everyone in your party before continuing.';
        }
        return;
      }
      if (respondError) { respondError.hidden = true; respondError.textContent = ''; }
      renderReviewStep();
      showStep('review', 'Review your RSVP before submitting.');
    });
  }

  // ---- Step 4: review ----
  function renderReviewStep() {
    const section = steps.get('review');
    if (!section || !household) return;

    const guestLines = household.guests.map((g) => {
      const r = responses.get(g.id);
      const status = r?.attending ? 'Attending' : 'Not attending';
      const extras = r?.attending && r.songRequest ? `song: ${r.songRequest}` : '';
      let line = `<li>${escapeHtml(g.name)}: ${status}${extras ? ` (${escapeHtml(extras)})` : ''}</li>`;

      if (g.has_plus_one && r) {
        const poAttending = effectivePlusOneAttending(r);
        const poName = r.plusOne?.name.trim();
        const poLabel = poName || 'Plus one';
        const poStatus = poAttending ? 'Attending' : 'Not attending';
        line += `<li class="rsvp-guest-preview-sub">${escapeHtml(poLabel)}: ${poStatus} <span class="rsvp-guest-preview-subnote">(plus one for ${escapeHtml(g.name)})</span></li>`;
      }
      return line;
    });

    const plusOneLines = plusOnes
      .filter((p) => p.name.trim())
      .map((p) => `<li>${escapeHtml(p.name.trim())}: Attending</li>`);

    section.innerHTML = `
      <h3 data-step-heading>Review your RSVP</h3>
      <ul class="rsvp-guest-preview">${[...guestLines, ...plusOneLines].join('')}</ul>
      <button type="button" class="btn-secondary" data-action="back">Back</button>
      <button type="button" class="btn-primary" id="rsvpSubmitBtn">Submit RSVP</button>
      <p class="rsvp-hint" id="rsvpVerifyHint" hidden>Verifying. If a checkbox appears below, please tick it to continue.</p>
      <p class="rsvp-error" id="rsvpSubmitError" hidden></p>
    `;

    section.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      showStep('respond');
    });

    const initialSubmitBtn = section.querySelector<HTMLButtonElement>('#rsvpSubmitBtn');
    if (initialSubmitBtn) initialSubmitBtn.disabled = !turnstileToken;
    const verifyHint = section.querySelector<HTMLElement>('#rsvpVerifyHint');
    if (verifyHint) verifyHint.hidden = !!turnstileToken;
    section.querySelector('#rsvpSubmitBtn')?.addEventListener('click', handleSubmit);
  }

  async function handleSubmit() {
    if (submitting || !household) return;
    const section = steps.get('review');
    const submitBtn = section?.querySelector<HTMLButtonElement>('#rsvpSubmitBtn');
    const submitError = section?.querySelector<HTMLElement>('#rsvpSubmitError');

    // The widget re-verifies in the background after resetTurnstile(); this
    // only fires if the user reaches "Submit" faster than that completes.
    if (!turnstileToken) {
      if (submitError) {
        submitError.hidden = false;
        submitError.textContent = 'Still verifying. Please try again in a moment.';
      }
      return;
    }

    submitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
    }
    if (submitError) {
      submitError.hidden = true;
      submitError.textContent = '';
    }

    const payload = {
      turnstileToken,
      householdId: household.id,
      responses: [...responses.entries()].map(([guestId, r]) => {
        const entry: {
          guestId: number;
          attending: boolean;
          songRequest?: string;
          plusOne?: { attending: boolean; name?: string };
        } = {
          guestId,
          attending: !!r.attending,
          songRequest: r.songRequest || undefined,
        };
        if (r.plusOne) {
          const attending = effectivePlusOneAttending(r);
          const name = r.plusOne.name.trim();
          entry.plusOne = { attending, name: attending && name ? name : undefined };
        }
        return entry;
      }),
      plusOnes: plusOnes
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name.trim(), attending: true as const })),
    };

    try {
      const res = await fetch(`${apiBase}/api/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.status === 'closed') {
        renderClosedInline(section);
        return;
      }
      if (data.status !== 'ok') {
        throw new Error(data.message || 'Something went wrong submitting your RSVP.');
      }

      renderSuccessStep();
      showStep('success', 'Your reply has been received. Thank you.');
    } catch (err) {
      if (submitError) {
        submitError.hidden = false;
        submitError.textContent =
          err instanceof Error
            ? `${err.message} Please try again, or ${contactFallbackText()}`
            : `We could not reach the server. Please try again, or ${contactFallbackText()}`;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit RSVP';
      }
    } finally {
      submitting = false;
      resetTurnstile();
    }
  }

  function renderClosedInline(section: HTMLElement | null | undefined) {
    if (!section) return;
    section.innerHTML = `
      <h3 data-step-heading>RSVPs are closed</h3>
      <p>The RSVP deadline has passed. ${escapeHtml(contactFallbackText())}</p>
    `;
  }

  function joinWithAnd(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  function firstName(fullName: string): string {
    return fullName.split(' ')[0];
  }

  function lastName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1];
  }

  function buildSuccessMessage(): string {
    if (!household) return "Thank you for letting us know.";

    const attendingNamed = household.guests.filter((g) => responses.get(g.id)?.attending === true);
    const decliningNamed = household.guests.filter((g) => responses.get(g.id)?.attending === false);

    const attributedAttendingNames: string[] = [];
    for (const g of household.guests) {
      if (!g.has_plus_one) continue;
      const r = responses.get(g.id);
      if (r && effectivePlusOneAttending(r)) {
        attributedAttendingNames.push(r.plusOne!.name.trim() || 'their plus one');
      }
    }
    const genericAttendingPlusOnes = plusOnes.filter((p) => p.name.trim());
    const allAttendingPlusOneNames = [...attributedAttendingNames, ...genericAttendingPlusOnes.map((p) => p.name.trim())];

    const attendingNames = [...attendingNamed.map((g) => g.name), ...allAttendingPlusOneNames];
    const decliningNames = decliningNamed.map((g) => g.name);

    const hasAttending = attendingNames.length > 0;
    const hasDeclining = decliningNames.length > 0;

    if (hasAttending && hasDeclining) {
      return `We cannot wait to celebrate with ${escapeHtml(joinWithAnd(attendingNames))}. We will miss ${escapeHtml(joinWithAnd(decliningNames))}.`;
    }

    if (!hasAttending && hasDeclining) {
      return `Thank you for letting us know, ${escapeHtml(joinWithAnd(decliningNames))}. You will be missed.`;
    }

    if (hasAttending) {
      if (attendingNames.length === 1) {
        return `We cannot wait to celebrate with you, ${escapeHtml(attendingNames[0])}!`;
      }
      if (attendingNames.length === 2) {
        return `We cannot wait to celebrate with ${escapeHtml(joinWithAnd(attendingNames))}!`;
      }
      // 3+ attending: use "the [Surname] family" when every attendee is a
      // named household guest sharing one surname (plus-ones usually only
      // give a first name, so they can't be verified against a family
      // surname) — otherwise fall back to a plain comma list.
      const surnames = new Set(attendingNamed.map((g) => lastName(g.name)));
      if (allAttendingPlusOneNames.length === 0 && surnames.size === 1) {
        return `We cannot wait to celebrate with the ${escapeHtml([...surnames][0])} family!`;
      }
      const displayNames = [...attendingNamed.map((g) => firstName(g.name)), ...allAttendingPlusOneNames];
      return `We cannot wait to celebrate with ${escapeHtml(joinWithAnd(displayNames))}!`;
    }

    return "Thank you for letting us know.";
  }

  function renderSuccessStep() {
    const section = steps.get('success');
    if (!section || !household) return;

    section.innerHTML = `
      <h3 data-step-heading>Thank you</h3>
      <p>${buildSuccessMessage()}</p>
      <p class="rsvp-recap">${formatEventDateTime()}<br />Holy Spirit Catholic Church, McAllen &amp; Los Encinos Event Center, Donna, TX</p>
    `;
  }

  showStep('find', undefined, false);
}

document.querySelectorAll<HTMLElement>('[data-rsvp-form]').forEach(initRsvpForm);
