import { z, startWebsiteZiwei } from '../../../server/api/src/website-ziwei-http';
import { INTERPRET_SYSTEM } from '../src/interpret';
import { chartKnowledge, KNOWLEDGE_VERSION } from '../src/knowledge';
import type { ZiweiChart, Star } from '../src/engine/types';
import { SCHOOL_STAR_ID_TO_NAME } from '../src/engine/school-data';
import { STAR_NAMES } from './star-names';
export { WebsiteZiweiService, ZIWEI_RESERVE_SCRIPT, ZIWEI_WINDOW_MS } from '../../../server/api/src/website-ziwei-service';

const starName = z.enum([...new Set([...Object.values(SCHOOL_STAR_ID_TO_NAME), ...STAR_NAMES, '副截'])]);
const star = z.object({name:starName,type:z.enum(['major','minor','lucky','sha']),siHua:z.enum(['','禄','权','科','忌']).optional(),brightness:z.enum(['庙','旺','得','利','平','不','闲','陷','地']).optional()}).strict();
const palace = z.object({name:z.enum(['命宫','兄弟','夫妻','子女','财帛','疾厄','迁移','仆役','官禄','田宅','福德','父母']),branch:z.number().int().min(0).max(11),stem:z.number().int().min(0).max(9),isMingGong:z.boolean().optional(),isShenGong:z.boolean().optional(),stars:z.array(star)}).strict();
const facts = z.object({conventions:z.object({calendar:z.literal('公历转农历，正月初一换年'),timezone:z.literal('UTC+8 标准时间'),trueSolar:z.boolean(),lateZishi:z.enum(['next-day','current-day']),leapMonth:z.enum(['split','prev-month','next-month','origin-month'])}).strict(),wuxingJu:z.enum(['水二局','木三局','金四局','土五局','火六局']),mingZhu:starName,shenZhu:starName,palaces:z.array(palace).length(12)}).strict().superRefine((chart,ctx) => {
  const stars = chart.palaces.flatMap(p => p.stars);
  if(new Set(chart.palaces.map(p => p.branch)).size !== 12 || new Set(chart.palaces.map(p => p.name)).size !== 12 || chart.palaces.filter(p => p.isMingGong).length !== 1 || chart.palaces.filter(p => p.isShenGong).length !== 1 || new Set(stars.map(s => s.name)).size !== stars.length || stars.filter(s => s.type === 'major').length !== 14) ctx.addIssue({code:'custom',message:'Invalid twelve-palace chart'});
});
export const requestSchema = z.object({schemaVersion:z.literal(1),requestId:z.uuid(),chartFingerprint:z.string().regex(/^[a-f0-9]{64}$/),knowledgeVersion:z.literal(KNOWLEDGE_VERSION),chart:facts}).strict();
export function serverMessages(request: z.infer<typeof requestSchema>) {
  const palaces = request.chart.palaces.map(p => ({...p,stars:p.stars.map(s => ({...s,brightnessRaw:s.brightness,brightness:s.brightness ? (['庙','旺'].includes(s.brightness) ? 'bright' : ['陷','不','闲'].includes(s.brightness) ? 'dim' : 'normal') : undefined}) as Star)}));
  // The detector only reads palaces and these two branch indices, never birthInfo.
  const chart = {palaces,mingGongBranch:palaces.find(p => p.isMingGong)!.branch,shenGongBranch:palaces.find(p => p.isShenGong)!.branch} as ZiweiChart;
  return [{role:'system' as const,content:INTERPRET_SYSTEM},{role:'user' as const,content:JSON.stringify({chart:request.chart,knowledge:chartKnowledge(chart)})}];
}
if (process.env.WEBSITE_ZIWEI_START === 'true') {
  startWebsiteZiwei(body => requestSchema.parse(body), request => serverMessages(request as z.infer<typeof requestSchema>)).catch(() => {console.error('Website Ziwei startup failed; configuration or persistence unavailable');process.exitCode=1;});
}
