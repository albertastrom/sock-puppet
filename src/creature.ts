import { config, type Joint } from "./config";
import type { Command, State, ExpressionEye } from "./protocol";
import type { Act, Behavior, CreatureUpdate } from "./actions";
import { gestureDuration, gestureOffset } from "./gestures";
import { sequences, type Expression, type Sequence } from "./expressions";
export type MotionLimits = Record<Joint,{min:number;max:number;speed:number;maxSpeed:number;acceleration:number}>;
export type CreatureStatus = {behavior:Behavior;gesture:string;expression:Expression;actionId:string|null;actionStatus:"idle"|"running"|"completed"|"canceled"|"expired"};
/** Pure, device-local behavior. Tick in 20ms steps; no network or wall-clock dependency. */
export class Creature {
  status: CreatureStatus={behavior:"stopped",gesture:"none",expression:"neutral",actionId:null,actionStatus:"idle"};
  private time=0; private seed:number; private restYaw=0; private idleGain=1; private jawGain=180;
  private action?:{value:Act;start:number;end:number};
  private expressionUntil=0; private nextBlink=2200; private blinkStart=-1000; private nextGaze=800;
  private gaze={x:0,y:0,size:1,convergence:0}; private gazeTarget={x:0,y:0}; private fixedGaze=false;
  private sequence?:Sequence; private sequenceStart=0;
  private rms=0; private speechAt=-Infinity; private speechSequence=-1; private jaw=0;
  private pose={yaw:0,pitch:0};
  constructor(seed=7, private limits:MotionLimits=config.motors) {this.seed=seed;}
  private random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  stop(){this.status={...this.status,behavior:"stopped",gesture:"none",actionStatus:this.action?"canceled":this.status.actionStatus};this.action=undefined;this.rms=0;this.speechAt=-Infinity;this.speechSequence=-1;this.sequence=undefined;this.expressionUntil=0;}
  accept(update: CreatureUpdate,id:string,state:State) {
    if(update.kind==="stop"){this.stop();return;}
    if(update.kind==="speech") {if(update.sequence>this.speechSequence){this.rms=update.rms;this.speechAt=this.time;this.speechSequence=update.sequence;}return;}
    if(this.status.behavior==="stopped") {this.pose={yaw:state.motors.baseYaw.angleDeg,pitch:state.motors.headPitch.angleDeg};this.restYaw=this.pose.yaw;this.jaw=state.motors.jawOpen.angleDeg;}
    if(update.kind==="behavior") {
      this.status={...this.status,behavior:update.behavior};
      if(update.behavior==="stopped") this.stop();
      this.idleGain=update.idleGain??this.idleGain;this.jawGain=update.jawGain??this.jawGain;
      if(update.gaze){this.gaze={...update.gaze};this.fixedGaze=true;}
      if(update.sequence!==undefined){this.sequence=update.sequence??undefined;this.sequenceStart=this.time;}
      return;
    }
    const a=update.action;
    if(a.yaw!==undefined&&(a.yaw<this.limits.baseYaw.min||a.yaw>this.limits.baseYaw.max)) throw new Error("Yaw exceeds device calibration");
    if(a.yaw!==undefined)this.restYaw=a.yaw;
    if(a.expression){this.status.expression=a.expression;this.expressionUntil=this.time+4000;}
    this.action={value:a,start:this.time,end:this.time+Math.min(update.ttlMs,Math.max(400,gestureDuration[a.gesture]*a.n))};
    this.status={...this.status,behavior:"performing",gesture:a.gesture,actionId:id,actionStatus:"running"};
  }
  tick(dt:number): Pick<Command,"motors"|"eyes">|undefined {
    this.time+=dt;
    if(this.status.behavior==="stopped")return;
    const t=this.time;
    if(this.action&&t>=this.action.end){this.status={...this.status,gesture:"none",actionStatus:t-this.action.start+1<gestureDuration[this.action.value.gesture]*this.action.value.n?"expired":"completed",behavior:"idle/listening"};this.action=undefined;}
    if(this.expressionUntil&&t>=this.expressionUntil){this.status.expression="neutral";this.expressionUntil=0;}
    if(t>=this.nextBlink){this.blinkStart=t;this.nextBlink=t+2200+this.random()*4200;}
    if(!this.fixedGaze&&t>=this.nextGaze){this.gazeTarget={x:(this.random()*2-1)*0.6,y:(this.random()*2-1)*0.4};this.nextGaze=t+600+this.random()*2200;}
    if(!this.fixedGaze){const k=1-Math.exp(-dt/40);this.gaze.x+=(this.gazeTarget.x-this.gaze.x)*k;this.gaze.y+=(this.gazeTarget.y-this.gaze.y)*k;}
    let expression=this.status.expression;
    if(this.sequence){const frames=sequences[this.sequence];let elapsed=(t-this.sequenceStart)%frames.reduce((sum,f)=>sum+f[1],0);for(const frame of frames){expression=frame[0];if(elapsed<frame[1])break;elapsed-=frame[1];}}
    const blink=t-this.blinkStart;const openness=this.sequence?1:blink<240?Math.abs(blink-120)/120:1;
    let yaw=this.restYaw+Math.sin(t/4500)*4*this.idleGain,pitch=(this.status.behavior==="thinking"?6:Math.sin(t/3200)*2)*this.idleGain;
    if(this.action){const {value,start}=this.action;const period=gestureDuration[value.gesture];const offset=gestureOffset(value.gesture,period?((t-start)%period)/period:0);yaw=this.restYaw+offset.yaw;pitch=offset.pitch;}
    const smoothing=1-Math.exp(-dt/120);this.pose.yaw+=(yaw-this.pose.yaw)*smoothing;this.pose.pitch+=(pitch-this.pose.pitch)*smoothing;
    const amplitude=t-this.speechAt<150?this.rms:0;
    const target=amplitude<0.012?0:Math.min(35,(amplitude-0.012)*this.jawGain);
    this.jaw+=(target-this.jaw)*(1-Math.exp(-dt/(target>this.jaw?25:75)));
    const motor=(joint:Joint,value:number)=>({angleDeg:Math.max(this.limits[joint].min,Math.min(this.limits[joint].max,value)),speedDegPerSec:Math.min(config.motors[joint].maxSpeed,this.limits[joint].maxSpeed)});
    const eye=(side:"left"|"right"):ExpressionEye=>({mode:"expression",name:expression,...this.gaze,openness,brightness:1,side});
    return {motors:{baseYaw:motor("baseYaw",this.pose.yaw),headPitch:motor("headPitch",this.pose.pitch),jawOpen:motor("jawOpen",this.jaw<0.05?0:this.jaw)},eyes:{left:eye("left"),right:eye("right")}};
  }
}
