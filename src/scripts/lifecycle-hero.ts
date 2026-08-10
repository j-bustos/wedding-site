import { RSVP_DEADLINE_ISO, WEDDING_DAY_START_ISO, WEDDING_DAY_END_ISO } from '../site.config';

const countdownEl = document.getElementById('heroStateCountdown');
const dayOfEl = document.getElementById('heroStateDayOf');
const afterEl = document.getElementById('heroStateAfter');
const cta = document.getElementById('heroCta');
const dayTimelineItems = document.querySelectorAll<HTMLLIElement>('#heroDayTimeline li');

const deadline = new Date(RSVP_DEADLINE_ISO).getTime();
const dayStart = new Date(WEDDING_DAY_START_ISO).getTime();
const dayEnd = new Date(WEDDING_DAY_END_ISO).getTime();

function show(el: HTMLElement | null) {
  if (el) el.hidden = false;
}
function hide(el: HTMLElement | null) {
  if (el) el.hidden = true;
}

function highlightCurrentEvent() {
  const now = Date.now();
  let current: HTMLLIElement | null = null;
  dayTimelineItems.forEach((item) => {
    const t = new Date(item.dataset.heroTime ?? '').getTime();
    item.classList.remove('hero-day-current');
    if (t <= now) current = item;
  });
  current?.classList.add('hero-day-current');
}

function applyState() {
  const now = Date.now();

  if (now >= dayEnd) {
    show(afterEl);
    hide(countdownEl);
    hide(dayOfEl);
    return;
  }

  if (now >= dayStart) {
    show(dayOfEl);
    hide(countdownEl);
    hide(afterEl);
    highlightCurrentEvent();
    return;
  }

  show(countdownEl);
  hide(dayOfEl);
  hide(afterEl);
  if (cta) {
    if (now > deadline) {
      cta.textContent = 'See the Schedule';
      cta.setAttribute('href', '#timeline');
    } else {
      cta.textContent = 'RSVP Now';
      cta.setAttribute('href', '#rsvp');
    }
  }
}

applyState();
setInterval(applyState, 60000);
