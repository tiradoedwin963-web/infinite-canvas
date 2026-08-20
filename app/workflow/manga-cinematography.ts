import type { ShotPlan } from "../ai/agent.ts";

const CROSS_SHOT_DIRECTION = /(?:转场|切镜|前镜|后镜|上一镜|下一镜|(?:切入|切到|匹配|衔接|承接).{0,14}(?:镜|shot|上一|下一|前|后)|(?:镜头|镜)\s*(?:\d+|[一二三四五六七八九十]+)|shot[-\s]?\d+)/i;
const LOCKED_OFF_CAMERA = /(?:固定机位|固定镜头|镜头固定|定机位|完全固定|静止机位)/;
const MEANINGFUL_ACTION = /(?:走|跑|移(?:动|向|开)?|入画|出画|转头|转身|抬|低头|伸|收|握|松|眨|皱|笑|哭|呼吸|颤|停笔|落下|滴落|流动|摆动|摇(?:晃|摆)?|飞(?:过|起)?|爬行|打开|关上|靠近|后退|前进|抚|书写|写下|拿起|放下|展开|收起|遮住|掠过|跳(?:起|下)?|坐下|起身|观察|看向|望向|听见|回应|树叶|叶片|昆虫|鸟鸣|风(?:吹|起)?|雨(?:落)?|雪(?:落)?|水纹|涟漪|烟雾|火焰|光(?:线)?(?:移动|变化|闪烁)?)/;

export function hasCrossShotDirection(value: string) {
  return CROSS_SHOT_DIRECTION.test(value);
}

export function currentShotText(value: string, fallback: string) {
  const filtered = value
    .split(/(?<=[。；\n])/)
    .filter((part) => !hasCrossShotDirection(part))
    .join("")
    .trim();
  return filtered || fallback;
}

export type MangaCinematographyWarning = {
  code: string;
  reason: string;
  suggestion: string;
  shotId?: string;
};

export type MangaCinematographyValidationOptions = {
  /**
   * Multi-shot projects deliberately keep editorial language in their plans.
   * Legacy single-shot plans retain the older, stricter validation by default.
   */
  allowCreativeDirections?: boolean;
};

function isCloseShot(shot: ShotPlan) {
  return /(?:大特写|特写|close[-\s]?up|extreme close)/i.test(shot.shotSize);
}

function isMiddleWideOrWiderShot(shot: ShotPlan) {
  return /(?:大远景|定场|远景|全景|中远景|牛仔|wide|establishing)/i.test(shot.shotSize);
}

function hasMeaningfulInShotAction(shot: ShotPlan) {
  return [
    shot.action,
    shot.blocking,
    shot.characterMovement,
    ...shot.timeline.flatMap((segment) => [
      segment.visualAction,
      segment.performance,
      segment.audio,
    ]),
  ].some((value) => MEANINGFUL_ACTION.test(value));
}

function hasNonLocalDirection(shot: ShotPlan) {
  return [
    shot.startFrame,
    shot.endFrame,
    ...shot.timeline.flatMap((segment) => [
      segment.visualAction,
      segment.performance,
      segment.camera,
      segment.audio,
    ]),
  ].some(hasCrossShotDirection);
}

function isConcreteFrameDescription(value: string) {
  const normalized = value.replace(/[。；，、\s]/g, "");
  return normalized.length >= 6 && !/^(?:无|同上|不变|保持不变|开始|结束|延续|镜头开始|镜头结束|按前镜|按后镜)$/.test(normalized);
}

function addRunWarnings(
  shots: ShotPlan[],
  warnings: MangaCinematographyWarning[],
) {
  let closeRun = 0;
  let middleWideRun = 0;
  for (const shot of shots) {
    closeRun = isCloseShot(shot) ? closeRun + 1 : 0;
    middleWideRun = isMiddleWideOrWiderShot(shot) ? middleWideRun + 1 : 0;
    if (closeRun === 4) {
      warnings.push({
        code: "close-shot-run",
        shotId: shot.shotId,
        reason: `${shot.shotId} 起形成连续 4 个特写或大特写，空间关系可能变弱。`,
        suggestion: "如叙事允许，在后续镜头加入环境或关系景别重置节奏。",
      });
    }
    if (middleWideRun === 4) {
      warnings.push({
        code: "wide-shot-run",
        shotId: shot.shotId,
        reason: `${shot.shotId} 起形成连续 4 个中远景及更远景别，表演信息可能不足。`,
        suggestion: "如叙事允许，在后续镜头加入中近景、反应特写或道具细节。",
      });
    }
  }
}

function shotScale(shot: ShotPlan) {
  if (isCloseShot(shot)) return "close";
  if (/(?:中近景|牛仔|medium[-\s]?close|medium close)/i.test(shot.shotSize)) {
    return "medium-close";
  }
  if (/(?:中景|\bmedium\b)/i.test(shot.shotSize)) return "medium";
  if (/(?:全景|\bfull\b)/i.test(shot.shotSize)) return "full";
  if (isMiddleWideOrWiderShot(shot)) return "wide";
  return null;
}

function addDistributionWarnings(
  shots: ShotPlan[],
  warnings: MangaCinematographyWarning[],
) {
  if (!shots.length) return;
  const bands = [
    ["wide", "大远景/远景", 5, 15],
    ["full", "全景", 10, 20],
    ["medium", "中景", 25, 35],
    ["medium-close", "中近景", 20, 30],
    ["close", "特写/大特写", 10, 20],
  ] as const;
  const counts = new Map<string, number>();
  shots.forEach((shot) => {
    const scale = shotScale(shot);
    if (scale) counts.set(scale, (counts.get(scale) ?? 0) + 1);
  });
  bands.forEach(([key, label, lower, upper]) => {
    const percent = ((counts.get(key) ?? 0) / shots.length) * 100;
    if (percent < lower || percent > upper) {
      warnings.push({
        code: `shot-scale-${key}`,
        reason: `${label}占镜头数 ${Math.round(percent)}%，偏离建议区间 ${lower}–${upper}%。`,
        suggestion: "可结合剧情信息、情绪和空间需要调整后续镜头景别；这只是摄影建议。",
      });
    }
  });
  const totalDuration = shots.reduce((total, shot) => total + shot.duration, 0);
  const longDuration = shots
    .filter((shot) => shot.duration >= 6)
    .reduce((total, shot) => total + shot.duration, 0);
  const longPercent = totalDuration ? (longDuration / totalDuration) * 100 : 0;
  if (longPercent < 10 || longPercent > 15) {
    warnings.push({
      code: "long-take-runtime",
      reason: `6–15 秒长镜累计时长占比为 ${Math.round(longPercent)}%，偏离建议区间 10–15%。`,
      suggestion: "可在不影响叙事完整性的前提下调整短镜与长镜的比例；这只是节奏建议。",
    });
  }
}

/**
 * Non-blocking cinematography guidance for the multi-shot storyboard table.
 * These results must never stop node creation or media scheduling by themselves.
 */
export function collectMangaCinematographyWarnings(shots: ShotPlan[]) {
  const warnings: MangaCinematographyWarning[] = [];
  shots.forEach((shot) => {
    if (hasNonLocalDirection(shot)) {
      warnings.push({
        code: "editorial-direction",
        shotId: shot.shotId,
        reason: `${shot.shotId} 包含跨镜头的剪辑意图。`,
        suggestion: "保留在分镜表和片段内切点中，并确保单个视频任务只引用自身片段中的切点。",
      });
    }
    if (LOCKED_OFF_CAMERA.test(shot.cameraMovement) && !hasMeaningfulInShotAction(shot)) {
      warnings.push({
        code: "locked-off-stillness",
        shotId: shot.shotId,
        reason: `${shot.shotId} 使用固定机位且镜内动作较少。`,
        suggestion: "如不是刻意停顿，可补充人物、道具、环境动作或轻微摄影机运动。",
      });
    }
  });
  addRunWarnings(shots, warnings);
  addDistributionWarnings(shots, warnings);
  return warnings;
}

export function validateMangaShotCinematography(
  shots: ShotPlan[],
  options: MangaCinematographyValidationOptions = {},
) {
  for (const shot of shots) {
    if (!isConcreteFrameDescription(shot.startFrame) || !isConcreteFrameDescription(shot.endFrame)) {
      return `${shot.shotId} 的首尾画面必须是当前镜头具体可见的画面状态。`;
    }
    if (!options.allowCreativeDirections && hasNonLocalDirection(shot)) {
      return `${shot.shotId} 的首尾画面或时间轴包含跨镜头场记；只能描述本镜可见画面、动作和声音。`;
    }
    if (!options.allowCreativeDirections && LOCKED_OFF_CAMERA.test(shot.cameraMovement) && !hasMeaningfulInShotAction(shot)) {
      return `${shot.shotId} 是没有人物、道具或环境动作的固定死镜头；请补充镜内动作或改用有目的的运镜。`;
    }
  }

  if (options.allowCreativeDirections) return null;

  let closeRun = 0;
  let middleWideRun = 0;
  for (const shot of shots) {
    closeRun = isCloseShot(shot) ? closeRun + 1 : 0;
    middleWideRun = isMiddleWideOrWiderShot(shot) ? middleWideRun + 1 : 0;
    if (closeRun >= 4) {
      return `${shot.shotId} 形成连续 4 个特写或大特写；特写最多连续使用 3 镜。`;
    }
    if (middleWideRun >= 4) {
      return `${shot.shotId} 形成连续 4 个中远景及更远景别；请插入中近景、特写、反应镜头或信息镜头重置节奏。`;
    }
  }
  return null;
}
