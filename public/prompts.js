// public/prompts.js - Short, easy pose prompts for Sharebooth

const POSE_PROMPTS = {
  funny: [
    "Silly face!",
    "Pretend you're shocked!",
    "Robot mode!",
    "Fake sneeze!",
    "Act surprised!",
    "Be a statue!",
    "Mouth wide open!",
    "Eyebrows way up!",
    "Invisible wall!",
    "Slow motion!",
  ],
  silly: [
    "Duck lips!",
    "Fish face!",
    "Tongue out!",
    "Cross your eyes!",
    "Puff your cheeks!",
    "Wink!",
    "Nose scrunch!",
    "Biggest smile ever!",
    "Double chin!",
    "One eye closed!",
  ],
  chill: [
    "Smile!",
    "Soft smile!",
    "Look happy!",
    "Peaceful vibes!",
    "Natural smile!",
    "Say cheese!",
    "Look cozy!",
    "Gentle look!",
    "Warm smile!",
    "Just be you!",
  ],
  hype: [
    "Peace signs!",
    "Hands up!",
    "Flex!",
    "Thumbs up!",
    "Victory pose!",
    "Fist pump!",
    "Jazz hands!",
    "Point at camera!",
    "Wave!",
    "Dab!",
  ],
  love: [
    "Group hug!",
    "Heart hands!",
    "Blow a kiss!",
    "Lean together!",
    "Pinky promise!",
    "Best friends pose!",
    "Hand on heart!",
    "Cheek to cheek!",
    "Arm around friend!",
    "Send love!",
  ],
};

function getRandomPrompt(category) {
  if (category === 'mix' || !POSE_PROMPTS[category]) {
    const all = Object.values(POSE_PROMPTS).flat();
    return all[Math.floor(Math.random() * all.length)];
  }
  const list = POSE_PROMPTS[category];
  return list[Math.floor(Math.random() * list.length)];
}
