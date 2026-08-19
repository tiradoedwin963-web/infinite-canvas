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

export function validateMangaShotCinematography(shots: ShotPlan[]) {
  for (const shot of shots) {
    if (!isConcreteFrameDescription(shot.startFrame) || !isConcreteFrameDescription(shot.endFrame)) {
      return `${shot.shotId} 的首尾画面必须是当前镜头具体可见的画面状态。`;
    }
    if (hasNonLocalDirection(shot)) {
      return `${shot.shotId} 的首尾画面或时间轴包含跨镜头场记；只能描述本镜可见画面、动作和声音。`;
    }
    if (LOCKED_OFF_CAMERA.test(shot.cameraMovement) && !hasMeaningfulInShotAction(shot)) {
      return `${shot.shotId} 是没有人物、道具或环境动作的固定死镜头；请补充镜内动作或改用有目的的运镜。`;
    }
  }

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
