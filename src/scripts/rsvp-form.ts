interface NamedGuest {
  id: number;
  fullName: string;
}

interface Household {
  id: number;
  label: string;
  guests: NamedGuest[];
  openPlusOneSeats: number;
  alreadyResponded: boolean;
}

interface GuestResponseState {
  attending: boolean | null;
  dietaryNotes: string;
  songRequest: string;
}

interface PlusOneState {
  name: string;
  dietaryNotes: string;
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
  let message = '';
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

  function showStep(name: StepName, announceText?: string, moveFocus = true) {
    steps.forEach((el, key) => {
      const active = key === name;
      el.hidden = !active;
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    const target = steps.get(name);
    // Only move focus on step *transitions* triggered by user action — not on
    // initial mount, where focusing/scrolling into the RSVP section would
    // yank the page's scroll position on every load.
    if (target && moveFocus) {
      const heading = target.querySelector<HTMLElement>('h3, h4, legend, [data-step-heading]');
      const focusTarget = heading ?? target.querySelector<HTMLElement>('input, button, textarea') ?? target;
      focusTarget.setAttribute('tabindex', focusTarget.hasAttribute('tabindex') ? focusTarget.getAttribute('tabindex')! : '-1');
      focusTarget.focus({ preventScroll: true });
    }
    if (announceText) announce(announceText);
  }

  function contactFallbackText(): string {
    if (contactPhone) return `Text us at ${contactPhone} and we'll sort it out.`;
    if (contactEmail) return `Email us at ${contactEmail} and we'll sort it out.`;
    return "Reach out to us and we'll sort it out.";
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
        throw new Error(data.message || 'Too many attempts — please wait a few minutes and try again.');
      }
      if (data.status === 'error') {
        throw new Error(data.message || `We couldn't reach the server. Please try again, or ${contactFallbackText()}`);
      }

      if (data.status === 'found') {
        household = data.household as Household;
        responses = new Map(household.guests.map((g) => [g.id, { attending: null, dietaryNotes: '', songRequest: '' }]));
        plusOnes = Array.from({ length: household.openPlusOneSeats }, () => ({ name: '', dietaryNotes: '' }));
        renderConfirmStep();
        showStep('confirm', `Found ${household.label}.`);
      } else if (data.status === 'ambiguous') {
        renderAmbiguousStep(data.guests as string[]);
        showStep('ambiguous', 'A few guests share that name — please pick which one is you.');
      } else {
        renderNotFoundStep();
        showStep('not-found', "We couldn't find that name.");
      }
    } catch (err) {
      if (findError) {
        findError.hidden = false;
        findError.textContent =
          err instanceof Error
            ? err.message
            : `We couldn't reach the server. Please try again, or ${contactFallbackText()}`;
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
    const alreadyRespondedBanner = household.alreadyResponded
      ? `<p class="rsvp-banner-note">You've already RSVP'd — submitting again updates your response.</p>`
      : '';
    section.innerHTML = `
      <h3 data-step-heading>${escapeHtml(household.label)}</h3>
      ${alreadyRespondedBanner}
      <ul class="rsvp-guest-preview">
        ${household.guests.map((g) => `<li>${escapeHtml(g.fullName)}</li>`).join('')}
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
      <h3 data-step-heading>Which one is you?</h3>
      <p class="rsvp-hint">A few guests on our list share that name. Enter your full name exactly as invited, including any middle name or initial, and try again.</p>
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
      <h3 data-step-heading>We couldn't find that name</h3>
      <p>Can't find your name? ${escapeHtml(contactFallbackText())}</p>
      <button type="button" class="btn-secondary" data-action="retry">Try a different name</button>
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
      .map(
        (g) => `
      <fieldset class="rsvp-guest-fieldset" data-guest-id="${g.id}">
        <legend>${escapeHtml(g.fullName)}</legend>
        <label class="rsvp-radio"><input type="radio" name="attend-${g.id}" value="yes" /> Joyfully accepts</label>
        <label class="rsvp-radio"><input type="radio" name="attend-${g.id}" value="no" /> Regretfully declines</label>
        <div class="rsvp-guest-extra" data-guest-extra="${g.id}" hidden>
          <label>Dietary notes (optional)<input type="text" data-field="dietary" data-guest="${g.id}" /></label>
          <label>Song request (optional)<input type="text" data-field="song" data-guest="${g.id}" /></label>
        </div>
      </fieldset>`
      )
      .join('');

    const plusOneFields = plusOnes
      .map(
        (_, i) => `
      <fieldset class="rsvp-guest-fieldset" data-plusone-index="${i}">
        <legend>Additional guest ${i + 1} (optional)</legend>
        <label>Name<input type="text" data-plusone-name="${i}" /></label>
        <label>Dietary notes (optional)<input type="text" data-plusone-dietary="${i}" /></label>
      </fieldset>`
      )
      .join('');

    const alreadyRespondedBanner = household.alreadyResponded
      ? `<p class="rsvp-banner-note">You've already RSVP'd — submitting again updates your response.</p>`
      : '';

    section.innerHTML = `
      <h3 data-step-heading>Who can make it?</h3>
      ${alreadyRespondedBanner}
      ${guestFields}
      ${plusOneFields}
      <label class="rsvp-message-label">Message for the couple (optional)<textarea id="rsvpMessageInput" rows="3"></textarea></label>
      <p class="rsvp-error" id="rsvpRespondError" hidden></p>
      <button type="button" class="btn-primary" data-action="review">Review your RSVP</button>
    `;

    section.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const fieldset = radio.closest('fieldset');
        const guestId = Number(fieldset?.dataset.guestId);
        const extra = section.querySelector<HTMLElement>(`[data-guest-extra="${guestId}"]`);
        const attending = radio.value === 'yes';
        if (extra) extra.hidden = !attending;
        const state = responses.get(guestId);
        if (state) state.attending = attending;
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const guestId = Number(input.dataset.guest);
        const state = responses.get(guestId);
        if (!state) return;
        if (input.dataset.field === 'dietary') state.dietaryNotes = input.value;
        if (input.dataset.field === 'song') state.songRequest = input.value;
      });
    });

    section.querySelectorAll<HTMLInputElement>('input[data-plusone-name]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.plusoneName);
        plusOnes[i].name = input.value;
      });
    });
    section.querySelectorAll<HTMLInputElement>('input[data-plusone-dietary]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.plusoneDietary);
        plusOnes[i].dietaryNotes = input.value;
      });
    });

    section.querySelector<HTMLTextAreaElement>('#rsvpMessageInput')?.addEventListener('input', (e) => {
      message = (e.target as HTMLTextAreaElement).value;
    });

    section.querySelector('[data-action="review"]')?.addEventListener('click', () => {
      const respondError = section.querySelector<HTMLElement>('#rsvpRespondError');
      const unanswered = [...responses.values()].some((r) => r.attending === null);
      if (unanswered) {
        if (respondError) {
          respondError.hidden = false;
          respondError.textContent = 'Please respond for everyone in your party before continuing.';
        }
        return;
      }
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
      const extras = r?.attending
        ? [r.dietaryNotes && `dietary: ${r.dietaryNotes}`, r.songRequest && `song: ${r.songRequest}`]
            .filter(Boolean)
            .join(', ')
        : '';
      return `<li>${escapeHtml(g.fullName)} — ${status}${extras ? ` (${escapeHtml(extras)})` : ''}</li>`;
    });

    const plusOneLines = plusOnes
      .filter((p) => p.name.trim())
      .map((p) => `<li>${escapeHtml(p.name.trim())} — Attending${p.dietaryNotes ? ` (dietary: ${escapeHtml(p.dietaryNotes)})` : ''}</li>`);

    section.innerHTML = `
      <h3 data-step-heading>Review your RSVP</h3>
      <ul class="rsvp-guest-preview">${[...guestLines, ...plusOneLines].join('')}</ul>
      ${message ? `<p class="rsvp-message-preview">Message: ${escapeHtml(message)}</p>` : ''}
      <button type="button" class="btn-secondary" data-action="back">Back</button>
      <button type="button" class="btn-primary" id="rsvpSubmitBtn">Submit RSVP</button>
      <p class="rsvp-error" id="rsvpSubmitError" hidden></p>
    `;

    section.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      showStep('respond');
    });

    const initialSubmitBtn = section.querySelector<HTMLButtonElement>('#rsvpSubmitBtn');
    if (initialSubmitBtn) initialSubmitBtn.disabled = !turnstileToken;
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
        submitError.textContent = "Still verifying you're human — please try again in a moment.";
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
      responses: [...responses.entries()].map(([guestId, r]) => ({
        guestId,
        attending: !!r.attending,
        dietaryNotes: r.dietaryNotes || undefined,
        songRequest: r.songRequest || undefined,
      })),
      plusOnes: plusOnes
        .filter((p) => p.name.trim())
        .map((p) => ({ name: p.name.trim(), attending: true as const, dietaryNotes: p.dietaryNotes || undefined })),
      message: message || undefined,
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
      showStep('success', "You're all set — thank you!");
    } catch (err) {
      if (submitError) {
        submitError.hidden = false;
        submitError.textContent =
          err instanceof Error
            ? `${err.message} Please try again, or ${contactFallbackText()}`
            : `We couldn't reach the server. Please try again, or ${contactFallbackText()}`;
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
    const attendingPlusOnes = plusOnes.filter((p) => p.name.trim());

    const attendingNames = [...attendingNamed.map((g) => g.fullName), ...attendingPlusOnes.map((p) => p.name.trim())];
    const decliningNames = decliningNamed.map((g) => g.fullName);

    const hasAttending = attendingNames.length > 0;
    const hasDeclining = decliningNames.length > 0;

    if (hasAttending && hasDeclining) {
      return `We can't wait to celebrate with ${escapeHtml(joinWithAnd(attendingNames))}. We'll miss ${escapeHtml(joinWithAnd(decliningNames))}.`;
    }

    if (!hasAttending && hasDeclining) {
      return `Thank you for letting us know, ${escapeHtml(joinWithAnd(decliningNames))}. You'll be missed.`;
    }

    if (hasAttending) {
      if (attendingNames.length === 1) {
        return `We can't wait to celebrate with you, ${escapeHtml(attendingNames[0])}!`;
      }
      if (attendingNames.length === 2) {
        return `We can't wait to celebrate with ${escapeHtml(joinWithAnd(attendingNames))}!`;
      }
      // 3+ attending: use "the [Surname] family" when every attendee is a
      // named household guest sharing one surname (plus-ones usually only
      // give a first name, so they can't be verified against a family
      // surname) — otherwise fall back to a plain comma list.
      const surnames = new Set(attendingNamed.map((g) => lastName(g.fullName)));
      if (attendingPlusOnes.length === 0 && surnames.size === 1) {
        return `We can't wait to celebrate with the ${escapeHtml([...surnames][0])} family!`;
      }
      const displayNames = [...attendingNamed.map((g) => firstName(g.fullName)), ...attendingPlusOnes.map((p) => p.name.trim())];
      return `We can't wait to celebrate with ${escapeHtml(joinWithAnd(displayNames))}!`;
    }

    return "Thank you for letting us know.";
  }

  function renderSuccessStep() {
    const section = steps.get('success');
    if (!section || !household) return;

    section.innerHTML = `
      <h3 data-step-heading>You're all set!</h3>
      <p>${buildSuccessMessage()}</p>
      <p class="rsvp-recap">${formatEventDateTime()} — Holy Spirit Catholic Church, McAllen &amp; Los Encinos Event Center, Donna, TX.</p>
    `;
  }

  showStep('find', undefined, false);
}

document.querySelectorAll<HTMLElement>('[data-rsvp-form]').forEach(initRsvpForm);
