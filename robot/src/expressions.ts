import type { EyeSpec } from "./eye-raster";
export type ExpressionDefinition = {id:string;name:string;group:string;spec:EyeSpec;left?:EyeSpec;right?:EyeSpec};
export const expressions = [
  { id:'neutral',    name:'Neutral',    group:'Idle and blink', spec:{ pupil:{ r:14, hl:1 } } },
  { id:'alert',      name:'Alert',      group:'Idle and blink', spec:{ rx:26, ry:56, n:4, pupil:{ r:12, hl:1 } } },
  { id:'blink1',     name:'Blink 25%',  group:'Idle and blink', spec:{ topCut:14, botCut:8, pupil:{ r:14, hl:1 } } },
  { id:'blink2',     name:'Blink 55%',  group:'Idle and blink', spec:{ topCut:32, botCut:20, pupil:{ r:13, hl:1 } } },
  { id:'blink3',     name:'Blink 85%',  group:'Idle and blink', spec:{ topCut:46, botCut:40, pupil:{ r:11 } } },
  { id:'closed',     name:'Closed',     group:'Idle and blink', spec:{ special:'bar', barT:5, barCurve:2 } },
  { id:'sleepy',     name:'Sleepy',     group:'Idle and blink', spec:{ topCut:56, pupil:{ r:13 } } },
  { id:'asleep',     name:'Asleep',     group:'Idle and blink', spec:{ special:'bar', barT:4, barCurve:-5, barY:6 } },

  { id:'happy',      name:'Happy',      group:'Warm',  spec:{ topCut:16, botCut:50, botCurve:16 } },
  { id:'joy',        name:'Joy',        group:'Warm',  spec:{ topCut:34, botCut:58, botCurve:18 } },
  { id:'content',    name:'Content',    group:'Warm',  spec:{ topCut:30, botCut:34, botCurve:-4, pupil:{ r:12, hl:1 } } },
  { id:'wink',       name:'Wink',       group:'Warm',  spec:{ pupil:{ r:14, hl:1 } }, left:{ special:'bar', barT:5, barCurve:-3, pupil:null } },
  { id:'curious',    name:'Curious',    group:'Warm',  spec:{ topCut:8, pupil:{ r:13, hl:1 }, bias:{ y:-0.45 } }, left:{ topCut:26 } },
  { id:'love',       name:'Smitten',    group:'Warm',  spec:{ special:'heart', s:26 } },

  { id:'sad',        name:'Sad',        group:'Cold',  spec:{ topCut:12, topTilt:-14, pupil:{ r:14, hl:1 }, bias:{ y:0.35 } } },
  { id:'crying',     name:'Crying',     group:'Cold',  spec:{ topCut:24, topTilt:-14, botCut:6, pupil:{ r:12 }, tear:{ r:5, dy:4, dx:6 }, bias:{ y:0.4 } } },
  { id:'angry',      name:'Angry',      group:'Cold',  spec:{ topCut:18, topTilt:20, pupil:{ r:12, hl:1 } } },
  { id:'furious',    name:'Furious',    group:'Cold',  spec:{ topCut:28, topTilt:26, botCut:8, botTilt:6, pupil:{ r:10 } } },
  { id:'annoyed',    name:'Annoyed',    group:'Cold',  spec:{ topCut:40, pupil:{ r:13, hl:1 } } },
  { id:'suspicious', name:'Suspicious', group:'Cold',  spec:{ topCut:34, botCut:26, pupil:{ r:12 }, bias:{ x:0.6 } } },
  { id:'smug',       name:'Smug',       group:'Cold',  spec:{ topCut:30, topTilt:12, botCut:14, pupil:{ r:12 }, bias:{ x:0.8 } } },
  { id:'bored',      name:'Bored',      group:'Cold',  spec:{ topCut:44, botCut:4, pupil:{ r:13 }, bias:{ y:0.5 } } },

  { id:'surprised',  name:'Surprised',  group:'Startled', spec:{ rx:27, ry:58, n:4, pupil:{ r:9, hl:1 } } },
  { id:'shocked',    name:'Shocked',    group:'Startled', spec:{ rx:27, ry:58, n:4, pupil:{ r:18, shape:'ring', t:5 } } },
  { id:'scared',     name:'Scared',     group:'Startled', spec:{ rx:26, ry:56, n:3.4, topCut:4, botCut:8, pupil:{ r:8, hl:1 }, bias:{ y:0.2 } } },
  { id:'focus',      name:'Focus',      group:'Startled', spec:{ topCut:20, botCut:16, pupil:{ r:11, shape:'cross' } } },

  { id:'slit',       name:'Slit',       group:'Machine', spec:{ pupil:{ r:15, ry:34, shape:'slit' } } },
  { id:'square',     name:'Square',     group:'Machine', spec:{ pupil:{ r:13, ry:15, shape:'square', hl:1 } } },
  { id:'scan',       name:'Scanning',   group:'Machine', spec:{ stripes:{ p:7, off:3 }, pupil:{ r:16, shape:'ring', t:4 } } },
  { id:'boot',       name:'Booting',    group:'Machine', spec:{ outline:2, stripes:{ p:9, off:4 } } },
  { id:'glitch',     name:'Glitch',     group:'Machine', spec:{ pupil:{ r:14 }, noise:{ seed:91, d:0.16 } } },
  { id:'dizzy',      name:'Dizzy',      group:'Machine', spec:{ special:'spiral', rmax:30, turns:2.6, t:5 } },
  { id:'dead',       name:'Offline',    group:'Machine', spec:{ special:'x', r:26, t:7 } },
] as const satisfies readonly ExpressionDefinition[];

export type Expression = typeof expressions[number]["id"];
export const expressionIds: readonly string[] = expressions.map(e => e.id);
export function expressionSpec(id: Expression, side: "left"|"right"): EyeSpec {
 const frame: ExpressionDefinition = expressions.find(e => e.id === id)!;
 return {...frame.spec, ...frame[side]};
}
export const sequences = {
  idle:    [['neutral',2000],['blink1',45],['blink2',40],['blink3',35],['closed',55],['blink3',35],['blink2',40],['blink1',45]],
  boot:    [['closed',260],['blink3',70],['blink2',55],['blink1',55],['alert',260],['boot',180],['scan',200],['boot',140],['neutral',700]],
  sleep:   [['neutral',600],['sleepy',700],['blink3',90],['closed',360],['sleepy',520],['asleep',1600]],
  angry:   [['neutral',320],['annoyed',220],['angry',360],['furious',900]],
  cheer:   [['neutral',280],['content',220],['happy',420],['joy',700],['happy',320]],
  confused:[['suspicious',520],['neutral',180],['curious',520],['annoyed',300]],
  fault:   [['neutral',240],['glitch',70],['scan',80],['glitch',60],['alert',180],['glitch',50],['dizzy',500],['dead',700]],
  wink:    [['neutral',700],['blink1',40],['wink',380],['blink1',40],['content',300],['neutral',400]],
} as const;


export type Sequence = keyof typeof sequences;
