// Port of language-learning-youtube-phrasebook's src/overlay/mcq.ts.
//
// Picks up to 4 MCQ options for `target`: distractors always come from the
// same language as the target (never mixed languages — that trivializes the
// question), preferring phrases that share a tag with the target (more
// similar, harder to tell apart) before falling back to any same-language
// phrase. Result can be fewer than 4 if the library doesn't have 3 other
// phrases in that language yet. Target's position is randomized.

function shareTag(a, b) {
  return a.some((tag) => b.includes(tag));
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

export function sampleChoices(target, pool) {
  const sameLanguage = pool.filter(
    (p) => p.languageName === target.languageName && p.id !== target.id,
  );

  const tagMatches = sameLanguage.filter((p) => shareTag(p.tags, target.tags));
  const others = sameLanguage.filter((p) => !shareTag(p.tags, target.tags));

  const distractors = [...shuffle(tagMatches), ...shuffle(others)].slice(0, 3);

  return [target, ...distractors].sort(() => Math.random() - 0.5);
}
