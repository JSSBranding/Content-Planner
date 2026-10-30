// Goedkeuringsproces voor AI-planningen (zie docs/werkwijze.md §4).
// Kernregel: een AI-planning komt alleen in de definitieve kalender na expliciete,
// actuele goedkeuring door een bevoegde social media manager.

export const PLAN_STATUS = Object.freeze({
  CONCEPT: 'concept',
  IN_CONTROLE: 'in_controle',
  AANPASSEN: 'aanpassen',
  GOEDGEKEURD: 'goedgekeurd',
  TOEGEVOEGD: 'toegevoegd_aan_kalender',
});

export const ACTIONS = Object.freeze({
  AANPASSEN: 'Conceptplanning aanpassen',
  NIEUWE_VERDELING: 'Nieuwe verdeling voorstellen',
  GOEDKEUREN: 'Planning goedkeuren en toevoegen aan kalender',
});

const APPROVER_ROLES = new Set(['admin', 'social_media_manager']);

export class PlanError extends Error {}

export function canApprove(user) {
  return Boolean(user && APPROVER_ROLES.has(user.role));
}

function assertApprover(user) {
  if (!canApprove(user)) throw new PlanError('Alleen een bevoegde social media manager mag dit doen.');
}

function assertNotFinal(plan) {
  if (plan.status === PLAN_STATUS.TOEGEVOEGD) throw new PlanError('Planning staat al in de kalender.');
}

function clearApproval(plan) {
  return { ...plan, approvedBy: null, approvedAt: null, approvedGeneration: null };
}

export function createPlan({ clientId, items }) {
  return clearApproval({ clientId, items, status: PLAN_STATUS.CONCEPT, generation: 1 });
}

export function submitForReview(plan) {
  if (plan.status !== PLAN_STATUS.CONCEPT) throw new PlanError('Alleen een concept kan ter controle.');
  return { ...plan, status: PLAN_STATUS.IN_CONTROLE };
}

// Handmatige wijziging (datums, tijden, onderwerpen, kanalen, volgorde, beelden).
// Hoeft niet opnieuw door AI goedgekeurd te worden. Bewerkt de manager een al goedgekeurde
// planning, dan blijft die goedgekeurd; ieder ander zet hem terug naar 'aanpassen'.
export function editManually(plan, user, items) {
  assertNotFinal(plan);
  if (!user) throw new PlanError('Onbekende gebruiker.');
  if (plan.status === PLAN_STATUS.GOEDGEKEURD && canApprove(user)) {
    return { ...plan, items };
  }
  return clearApproval({ ...plan, items, status: PLAN_STATUS.AANPASSEN });
}

// AI-herverdeling van datums, tijden of kanalen: altijd opnieuw akkoord nodig.
export function applyAiRedistribution(plan, items) {
  assertNotFinal(plan);
  return clearApproval({ ...plan, items, status: PLAN_STATUS.IN_CONTROLE, generation: plan.generation + 1 });
}

// Hele voorstel opnieuw laten genereren.
export function regenerate(plan, items) {
  assertNotFinal(plan);
  return clearApproval({ ...plan, items, status: PLAN_STATUS.CONCEPT, generation: plan.generation + 1 });
}

export function approve(plan, user, now = new Date()) {
  assertApprover(user);
  if (![PLAN_STATUS.IN_CONTROLE, PLAN_STATUS.AANPASSEN].includes(plan.status)) {
    throw new PlanError('Alleen een planning in controle of in aanpassing kan worden goedgekeurd.');
  }
  return {
    ...plan,
    status: PLAN_STATUS.GOEDGEKEURD,
    approvedBy: user.id,
    approvedAt: now.toISOString(),
    approvedGeneration: plan.generation,
  };
}

const cellKey = (date, channel) => `${date}|${channel}`;

// Zet planregels om naar kanaalcellen (één per datum × kanaal).
export function toCells(plan) {
  return plan.items.flatMap((item) =>
    item.channels.map((channel) => ({
      date: item.date,
      time: item.time ?? null,
      channel,
      topic: item.topic,
      pillar: item.pillar ?? null,
      clientInputId: item.clientInputId ?? null,
      media: item.media ?? [],
    })),
  );
}

// Bestaande content op dezelfde datum + kanaal.
export function findConflicts(plan, existingCalendarItems) {
  const existing = new Map(
    existingCalendarItems
      .filter((c) => c.clientId === plan.clientId)
      .map((c) => [cellKey(c.date, c.channel), c]),
  );
  return toCells(plan)
    .filter((cell) => existing.has(cellKey(cell.date, cell.channel)))
    .map((cell) => ({ cell, existing: existing.get(cellKey(cell.date, cell.channel)) }));
}

// Plaatst een goedgekeurde planning in de kalender. Elk conflict moet expliciet zijn
// opgelost met 'skip' of 'replace' (key: "datum|kanaal"); anders wordt er niets toegevoegd.
export function addToCalendar(plan, user, existingCalendarItems, resolutions = {}, now = new Date()) {
  assertApprover(user);
  if (plan.status !== PLAN_STATUS.GOEDGEKEURD || plan.approvedGeneration !== plan.generation) {
    throw new PlanError('Planning is niet (meer) goedgekeurd door een manager.');
  }
  const conflicts = findConflicts(plan, existingCalendarItems);
  const unresolved = conflicts.filter(
    ({ cell }) => !['skip', 'replace'].includes(resolutions[cellKey(cell.date, cell.channel)]),
  );
  if (unresolved.length > 0) {
    const err = new PlanError('Er staat al content op enkele datums en kanalen.');
    err.conflicts = unresolved;
    throw err;
  }

  const cells = toCells(plan).filter(
    (cell) => resolutions[cellKey(cell.date, cell.channel)] !== 'skip',
  );
  return {
    plan: { ...plan, status: PLAN_STATUS.TOEGEVOEGD, addedToCalendarAt: now.toISOString() },
    newCalendarItems: cells.map((cell) => ({
      clientId: plan.clientId,
      date: cell.date,
      time: cell.time,
      channel: cell.channel,
      body: null, // teksten per kanaal volgen in stap 4
      sourceInfo: cell.topic,
      media: cell.media,
      status: 'placeholder_actie_nodig',
      isDraft: true,
    })),
    replaced: conflicts
      .filter(({ cell }) => resolutions[cellKey(cell.date, cell.channel)] === 'replace')
      .map(({ existing }) => existing),
  };
}
