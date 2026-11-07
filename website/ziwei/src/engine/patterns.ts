/** Adapted from Renhuai123/ziwei-doushu a600484a49255039d0725f1ba9e11ca81a948f97 (MIT).
 * Browser adaptation: removed server-only marker; replaced narrative verdicts with a neutral description.
 * Star positions, pattern conditions and classical source labels are retained. */
import type { ZiweiChart, Palace, Star, SiHua } from './types';
export interface PatternCondition {
    required: string[];
    bonus?: string[];
    breaking?: string[];
}
export interface Pattern {
    name: string;
    level: 'excellent' | 'good' | 'neutral' | 'caution';
    description: string;
    palaces: string[];
    conditions?: PatternCondition;
    source?: string;
}
const SHA_NAMES = ['擎羊', '陀罗', '火星', '铃星', '地空', '地劫'];
const SHA_HARD = ['擎羊', '陀罗', '火星', '铃星'];
const SHA_KONG = ['地空', '地劫'];
const ZUO_YOU = ['左辅', '右弼'];
const CHANG_QU = ['文昌', '文曲'];
const KUI_YUE = ['天魁', '天钺'];
function getMajorStarNames(palace: Palace): string[] {
    return palace.stars.filter(s => s.type === 'major').map(s => s.name);
}
function findStar(palace: Palace, name: string): Star | undefined {
    return palace.stars.find(s => s.name === name);
}
function hasStar(palace: Palace, name: string): boolean {
    return palace.stars.some(s => s.name === name);
}
function findStarPalace(chart: ZiweiChart, name: string): Palace | undefined {
    return chart.palaces.find(p => p.stars.some(s => s.name === name));
}
function getPalaceByBranch(chart: ZiweiChart, branch: number): Palace | undefined {
    return chart.palaces.find(p => p.branch === ((branch % 12) + 12) % 12);
}
function shaCountInPalace(palace: Palace, list: string[] = SHA_HARD): number {
    return palace.stars.filter(s => list.includes(s.name)).length;
}
function hasShaInPalace(palace: Palace, list: string[] = SHA_NAMES): boolean {
    return palace.stars.some(s => list.includes(s.name));
}
function getSanFangPalaces(chart: ZiweiChart): Palace[] {
    const m = chart.mingGongBranch;
    const branches = [m, (m + 4) % 12, (m + 8) % 12, (m + 6) % 12];
    return chart.palaces.filter(p => branches.includes(p.branch));
}
function isInSanFang(chart: ZiweiChart, branch: number): boolean {
    const m = chart.mingGongBranch;
    return [m, (m + 4) % 12, (m + 8) % 12, (m + 6) % 12].includes(branch);
}
function getDuiGong(chart: ZiweiChart, branch: number): Palace | undefined {
    return getPalaceByBranch(chart, (branch + 6) % 12);
}
function getJiaPalaces(chart: ZiweiChart, branch: number): {
    prev?: Palace;
    next?: Palace;
} {
    return {
        prev: getPalaceByBranch(chart, (branch + 11) % 12),
        next: getPalaceByBranch(chart, (branch + 1) % 12),
    };
}
function sanFangAllStars(chart: ZiweiChart): Set<string> {
    return new Set(getSanFangPalaces(chart).flatMap(p => p.stars.map(s => s.name)));
}
function sanFangShaCount(chart: ZiweiChart, list: string[] = SHA_HARD): number {
    return getSanFangPalaces(chart).reduce((sum, p) => sum + shaCountInPalace(p, list), 0);
}
function isBright(palace: Palace, starName: string): boolean {
    const s = findStar(palace, starName);
    return s?.brightness === 'bright';
}
function isDim(palace: Palace, starName: string): boolean {
    const s = findStar(palace, starName);
    return s?.brightness === 'dim';
}
function getStarSiHua(palace: Palace, starName: string): Star['siHua'] | undefined {
    return findStar(palace, starName)?.siHua;
}
function palaceHasSiHua(palace: Palace, hua: SiHua): boolean {
    return palace.stars.some(s => s.siHua === hua);
}
function sanFangHasSiHua(chart: ZiweiChart, hua: SiHua): boolean {
    return getSanFangPalaces(chart).some(p => palaceHasSiHua(p, hua));
}
const BRANCH_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function detectJunChenQingHui(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    if (!hasStar(ming, '紫微'))
        return;
    const sanFangSet = sanFangAllStars(chart);
    const hasZuo = sanFangSet.has('左辅');
    const hasYou = sanFangSet.has('右弼');
    if (!hasZuo || !hasYou)
        return;
    const required = ['紫微入命', '左辅右弼同会三方四正'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangSet.has('文昌') || sanFangSet.has('文曲'))
        bonus.push('再会文昌或文曲');
    if (sanFangSet.has('天魁') || sanFangSet.has('天钺'))
        bonus.push('魁钺贵人加照');
    if (getStarSiHua(ming, '紫微') === '权')
        bonus.push('紫微化权');
    if (sanFangShaCount(chart, SHA_KONG) >= 2)
        breaking.push('地空地劫双夹会照（紫微忌空劫）');
    patterns.push({
        name: '君臣庆会',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·君臣庆会格》',
    });
}
function detectZiFu(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const ziwei = findStarPalace(chart, '紫微');
    const tianfu = findStarPalace(chart, '天府');
    if (!ziwei || !tianfu || ziwei.branch !== tianfu.branch)
        return;
    const inMing = ziwei.branch === chart.mingGongBranch;
    const required = inMing
        ? ['紫微天府同入命宫']
        : ['紫微天府同宫（不在命宫，会照减力）'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    const sanFangSet = sanFangAllStars(chart);
    if (sanFangSet.has('左辅') && sanFangSet.has('右弼'))
        bonus.push('左辅右弼同会');
    if (sanFangSet.has('文昌') || sanFangSet.has('文曲'))
        bonus.push('再会昌曲');
    if (hasShaInPalace(ziwei, SHA_KONG))
        breaking.push('紫府宫坐空劫（破紫府之贵气）');
    if (shaCountInPalace(ziwei, SHA_HARD) >= 2)
        breaking.push('紫府宫见双煞同坐');
    patterns.push({
        name: '紫府同宫',
        level: inMing && !breaking.length ? 'excellent' : 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [ziwei.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·紫府同宫格》',
    });
}
function detectFuXiangChaoYuan(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const tianfu = findStarPalace(chart, '天府');
    const tianxiang = findStarPalace(chart, '天相');
    if (!tianfu || !tianxiang)
        return;
    if (!isInSanFang(chart, tianfu.branch) || !isInSanFang(chart, tianxiang.branch))
        return;
    if (tianfu.branch === chart.mingGongBranch && tianxiang.branch === chart.mingGongBranch)
        return;
    if (tianfu.branch === tianxiang.branch)
        return;
    const required = ['天府坐命三方', '天相坐命三方', '两星不同宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (hasStar(ming, '禄存') || palaceHasSiHua(ming, '禄'))
        bonus.push('命宫见禄');
    if (sanFangAllStars(chart).has('左辅'))
        bonus.push('再会左辅');
    if (hasShaInPalace(ming, SHA_HARD))
        breaking.push('命宫坐煞星');
    if (sanFangShaCount(chart, SHA_HARD) >= 3)
        breaking.push('三方四正煞星过多');
    patterns.push({
        name: '府相朝垣',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [tianfu.name, tianxiang.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·府相朝垣格》',
    });
}
function detectYangLiangChangLu(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!sanFangSet.has('太阳') || !sanFangSet.has('天梁') ||
        !sanFangSet.has('文昌') || !sanFangSet.has('禄存'))
        return;
    const sun = findStarPalace(chart, '太阳')!;
    const liang = findStarPalace(chart, '天梁')!;
    const required = [
        '太阳会命宫三方',
        '天梁会命宫三方',
        '文昌会命宫三方',
        '禄存会命宫三方',
    ];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (isBright(sun, '太阳'))
        bonus.push('太阳庙旺');
    if (isBright(liang, '天梁'))
        bonus.push('天梁庙旺');
    if (sanFangHasSiHua(chart, '科'))
        bonus.push('再会化科');
    if (isDim(sun, '太阳'))
        breaking.push('太阳落陷（阳梁失辉）');
    if (sanFangShaCount(chart, SHA_HARD) >= 2)
        breaking.push('三方煞重');
    patterns.push({
        name: '阳梁昌禄',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [sun.name, liang.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·阳梁昌禄格》',
    });
}
function detectHuoTanLingTan(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const tan = findStarPalace(chart, '贪狼');
    if (!tan)
        return;
    const huo = findStarPalace(chart, '火星');
    const ling = findStarPalace(chart, '铃星');
    for (const [shaName, shaPalace] of [['火星', huo], ['铃星', ling]] as const) {
        if (!shaPalace)
            continue;
        const sameOrTrine = tan.branch === shaPalace.branch ||
            (tan.branch + 4) % 12 === shaPalace.branch ||
            (tan.branch + 8) % 12 === shaPalace.branch ||
            (tan.branch + 6) % 12 === shaPalace.branch;
        if (!sameOrTrine)
            continue;
        if (!isInSanFang(chart, tan.branch))
            continue;
        const required = [`贪狼${tan.branch === shaPalace.branch ? '同宫' : '会照'}${shaName}`, '贪狼会照命宫三方'];
        const bonus: string[] = [];
        const breaking: string[] = [];
        if (isBright(tan, '贪狼'))
            bonus.push('贪狼庙旺');
        if (getStarSiHua(tan, '贪狼') === '禄' || getStarSiHua(tan, '贪狼') === '权')
            bonus.push('贪狼化禄/化权');
        if (hasShaInPalace(tan, ['擎羊', '陀罗']))
            breaking.push('贪狼宫又见羊陀（破横发之力）');
        if (hasShaInPalace(tan, SHA_KONG))
            breaking.push('贪狼遇空劫（财来财去）');
        patterns.push({
            name: shaName === '火星' ? '火贪格' : '铃贪格',
            level: breaking.length ? 'good' : 'excellent',
            description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
            palaces: [tan.name, shaPalace.name],
            conditions: { required, bonus, breaking },
            source: '《紫微斗数骨髓赋》',
        });
    }
}
function detectWuTan(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const wu = findStarPalace(chart, '武曲');
    const tan = findStarPalace(chart, '贪狼');
    if (!wu || !tan)
        return;
    const sameOrOppose = wu.branch === tan.branch || (wu.branch + 6) % 12 === tan.branch;
    if (!sameOrOppose)
        return;
    if (!isInSanFang(chart, wu.branch) && !isInSanFang(chart, tan.branch))
        return;
    const required = [
        wu.branch === tan.branch ? '武曲贪狼同宫（丑/未）' : '武曲贪狼对宫拱照',
        '会照命宫三方',
    ];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangAllStars(chart).has('火星') || sanFangAllStars(chart).has('铃星'))
        bonus.push('再遇火星/铃星（火贪/铃贪叠加）');
    if (getStarSiHua(wu, '武曲') === '禄')
        bonus.push('武曲化禄');
    if (hasShaInPalace(wu, ['擎羊', '陀罗']))
        breaking.push('武贪宫见羊陀');
    if (hasShaInPalace(wu, SHA_KONG))
        breaking.push('武贪宫遇空劫');
    patterns.push({
        name: '武贪格',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [wu.name, tan.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数骨髓赋》',
    });
}
function detectShaPoLang(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    const has = ['七杀', '破军', '贪狼'].filter(s => sanFangSet.has(s));
    if (has.length < 3)
        return;
    const required = ['七杀、破军、贪狼三星齐入命宫三方四正'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangHasSiHua(chart, '禄') || sanFangHasSiHua(chart, '权'))
        bonus.push('三方有化禄或化权（动得有力）');
    if (sanFangSet.has('左辅') && sanFangSet.has('右弼'))
        bonus.push('辅弼同会（变动中得贵人）');
    if (sanFangShaCount(chart, SHA_HARD) >= 3)
        breaking.push('煞星过重（动而无成）');
    if (hasShaInPalace(ming, SHA_KONG))
        breaking.push('命坐空劫（动得辛苦）');
    patterns.push({
        name: '杀破狼',
        level: breaking.length ? 'caution' : 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: getSanFangPalaces(chart).filter(p => has.includes(getMajorStarNames(p)[0])).map(p => p.name),
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·杀破狼》',
    });
}
function detectJiYueTongLiang(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    const has = ['天机', '太阴', '天同', '天梁'].filter(s => sanFangSet.has(s));
    if (has.length < 4)
        return;
    const required = ['天机、太阴、天同、天梁四星齐入命宫三方四正'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangSet.has('文昌') || sanFangSet.has('文曲'))
        bonus.push('再会昌曲');
    if (sanFangHasSiHua(chart, '科'))
        bonus.push('再会化科');
    if (sanFangShaCount(chart, SHA_HARD) >= 3)
        breaking.push('煞星过多（机月同梁忌煞）');
    if (hasShaInPalace(ming, SHA_HARD))
        breaking.push('命宫坐煞');
    patterns.push({
        name: '机月同梁',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: getSanFangPalaces(chart).filter(p => has.some(s => getMajorStarNames(p).includes(s))).map(p => p.name),
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·机月同梁格》',
    });
}
function detectLianXiang(chart: ZiweiChart, patterns: Pattern[]) {
    const lian = findStarPalace(chart, '廉贞');
    const xiang = findStarPalace(chart, '天相');
    if (!lian || !xiang || lian.branch !== xiang.branch)
        return;
    const inMing = lian.branch === chart.mingGongBranch;
    const required = ['廉贞天相同宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (hasStar(lian, '禄存') || getStarSiHua(lian, '廉贞') === '禄')
        bonus.push('见禄存或廉贞化禄');
    if (sanFangAllStars(chart).has('左辅'))
        bonus.push('左辅会照');
    if (hasShaInPalace(lian, ['擎羊']))
        breaking.push('廉相宫坐擎羊（廉杀羊倾向）');
    if (getStarSiHua(lian, '廉贞') === '忌')
        breaking.push('廉贞化忌');
    patterns.push({
        name: '廉贞天相格',
        level: breaking.length ? 'caution' : (inMing ? 'good' : 'neutral'),
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [lian.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书》',
    });
}
function detectWuQiSha(chart: ZiweiChart, patterns: Pattern[]) {
    const wu = findStarPalace(chart, '武曲');
    const qi = findStarPalace(chart, '七杀');
    if (!wu || !qi || wu.branch !== qi.branch)
        return;
    const inMing = wu.branch === chart.mingGongBranch;
    const required = ['武曲七杀同宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (getStarSiHua(wu, '武曲') === '权')
        bonus.push('武曲化权');
    if (getStarSiHua(wu, '武曲') === '禄')
        bonus.push('武曲化禄');
    if (getStarSiHua(wu, '武曲') === '忌')
        breaking.push('武曲化忌（武曲化忌为财劫之兆）');
    if (hasShaInPalace(wu, ['擎羊', '陀罗', '火星', '铃星']))
        breaking.push('武杀宫煞星过多');
    patterns.push({
        name: '武曲七杀',
        level: breaking.length ? 'caution' : (inMing ? 'excellent' : 'good'),
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [wu.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书》',
    });
}
function detectTongLiang(chart: ZiweiChart, patterns: Pattern[]) {
    const tong = findStarPalace(chart, '天同');
    const liang = findStarPalace(chart, '天梁');
    if (!tong || !liang || tong.branch !== liang.branch)
        return;
    const required = ['天同天梁同宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangAllStars(chart).has('文昌'))
        bonus.push('文昌会照');
    if (getStarSiHua(tong, '天同') === '禄')
        bonus.push('天同化禄');
    if (hasShaInPalace(tong, SHA_HARD))
        breaking.push('煞星同坐');
    patterns.push({
        name: '天同天梁格',
        level: breaking.length ? 'neutral' : 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [tong.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书》',
    });
}
function detectRiYueTongGong(chart: ZiweiChart, patterns: Pattern[]) {
    const sun = findStarPalace(chart, '太阳');
    const moon = findStarPalace(chart, '太阴');
    if (!sun || !moon || sun.branch !== moon.branch)
        return;
    if (sun.branch !== 1 && sun.branch !== 7)
        return;
    const inMing = sun.branch === chart.mingGongBranch;
    const required = [`太阳太阴同入${BRANCH_NAMES[sun.branch]}宫`];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sun.branch === 7)
        bonus.push('未宫日月同辉（古书云未宫日月双美）');
    if (sanFangAllStars(chart).has('文昌') && sanFangAllStars(chart).has('文曲'))
        bonus.push('昌曲会照');
    if (hasShaInPalace(sun, SHA_HARD))
        breaking.push('日月宫煞星同坐');
    patterns.push({
        name: '日月同宫',
        level: breaking.length ? 'good' : (inMing ? 'excellent' : 'good'),
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [sun.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书》',
    });
}
function detectRiYueJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const prevHasSun = hasStar(prev, '太阳');
    const prevHasMoon = hasStar(prev, '太阴');
    const nextHasSun = hasStar(next, '太阳');
    const nextHasMoon = hasStar(next, '太阴');
    const ok = (prevHasSun && nextHasMoon) || (prevHasMoon && nextHasSun);
    if (!ok)
        return;
    const sunPalace = prevHasSun ? prev : next;
    const moonPalace = prevHasMoon ? prev : next;
    const required = ['太阳太阴分居命宫前后两宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (isBright(sunPalace, '太阳'))
        bonus.push('太阳庙旺');
    if (isBright(moonPalace, '太阴'))
        bonus.push('太阴庙旺');
    if (isDim(sunPalace, '太阳') || isDim(moonPalace, '太阴'))
        breaking.push('日月落陷（夹命无光）');
    patterns.push({
        name: '日月夹命',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [sunPalace.name, moonPalace.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·日月夹命》',
    });
}
function detectJuRiTongGong(chart: ZiweiChart, patterns: Pattern[]) {
    const ju = findStarPalace(chart, '巨门');
    const sun = findStarPalace(chart, '太阳');
    if (!ju || !sun || ju.branch !== sun.branch)
        return;
    if (ju.branch !== 2 && ju.branch !== 8)
        return;
    const inMing = ju.branch === chart.mingGongBranch;
    const required = [`巨门太阳同入${BRANCH_NAMES[ju.branch]}宫`];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (ju.branch === 2)
        bonus.push('寅宫太阳庙旺，巨门得日光化解是非');
    if (getStarSiHua(ju, '巨门') === '禄' || getStarSiHua(ju, '巨门') === '权')
        bonus.push('巨门化禄/化权（口才生财）');
    if (getStarSiHua(ju, '巨门') === '忌')
        breaking.push('巨门化忌（口舌官非）');
    if (ju.branch === 8)
        breaking.push('申宫太阳偏西，巨门暗曜更显');
    patterns.push({
        name: '巨日同宫',
        level: breaking.length ? 'caution' : (inMing && ju.branch === 2 ? 'excellent' : 'good'),
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [ju.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·巨日同宫》',
    });
}
function detectShiZhongYinYu(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    if (!hasStar(ming, '巨门'))
        return;
    if (ming.branch !== 0 && ming.branch !== 6)
        return;
    const required = [`巨门入命于${BRANCH_NAMES[ming.branch]}宫`];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (getStarSiHua(ming, '巨门') === '禄' || getStarSiHua(ming, '巨门') === '权')
        bonus.push('巨门化禄/化权');
    if (sanFangAllStars(chart).has('文昌'))
        bonus.push('文昌会照（石中隐玉得明）');
    if (getStarSiHua(ming, '巨门') === '忌')
        breaking.push('巨门化忌（玉藏深泥）');
    if (hasShaInPalace(ming, SHA_HARD))
        breaking.push('命坐煞星');
    patterns.push({
        name: '石中隐玉',
        level: breaking.length ? 'caution' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数骨髓赋·石中隐玉》',
    });
}
function detectMingZhuChuHai(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    if (ming.branch !== 7)
        return;
    if (getMajorStarNames(ming).length > 0)
        return;
    const dui = getDuiGong(chart, ming.branch);
    if (!dui)
        return;
    if (!hasStar(dui, '太阳') || !hasStar(dui, '太阴'))
        return;
    const required = ['命宫在未为空宫', '对宫丑宫为太阳太阴同度'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangAllStars(chart).has('文昌') || sanFangAllStars(chart).has('文曲'))
        bonus.push('再会昌曲');
    if (sanFangAllStars(chart).has('左辅') || sanFangAllStars(chart).has('右弼'))
        bonus.push('辅弼相助');
    if (sanFangShaCount(chart, SHA_HARD) >= 2)
        breaking.push('煞星会照（珠光黯淡）');
    patterns.push({
        name: '明珠出海',
        level: breaking.length ? 'good' : 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', dui.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全集·明珠出海》',
    });
}
function detectZiWeiInMing(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    if (!hasStar(ming, '紫微') || hasStar(ming, '天府'))
        return;
    const required = ['紫微独坐命宫（无天府同坐）'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    const sanFangSet = sanFangAllStars(chart);
    if (sanFangSet.has('左辅') && sanFangSet.has('右弼'))
        bonus.push('左辅右弼同会');
    if (sanFangSet.has('文昌') && sanFangSet.has('文曲'))
        bonus.push('文昌文曲同会');
    if (!sanFangSet.has('左辅') && !sanFangSet.has('右弼'))
        breaking.push('无辅弼（孤君无臣）');
    if (hasShaInPalace(ming, SHA_KONG))
        breaking.push('紫微遇空劫（古书最忌）');
    patterns.push({
        name: '紫微入命',
        level: breaking.length ? 'caution' : (bonus.length ? 'excellent' : 'good'),
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书》',
    });
}
function detectFuBiJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const prevHasZuo = hasStar(prev, '左辅');
    const prevHasYou = hasStar(prev, '右弼');
    const nextHasZuo = hasStar(next, '左辅');
    const nextHasYou = hasStar(next, '右弼');
    if (!((prevHasZuo && nextHasYou) || (prevHasYou && nextHasZuo)))
        return;
    const required = ['左辅右弼分居命宫前后两宫'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangAllStars(chart).has('天魁') || sanFangAllStars(chart).has('天钺'))
        bonus.push('再会魁钺');
    patterns.push({
        name: '辅弼夹命',
        level: 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', prev.name, next.name],
        conditions: { required, bonus, breaking },
        source: '《紫微斗数全书·辅弼夹命》',
    });
}
function detectChangQuJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const prevHasChang = hasStar(prev, '文昌');
    const prevHasQu = hasStar(prev, '文曲');
    const nextHasChang = hasStar(next, '文昌');
    const nextHasQu = hasStar(next, '文曲');
    if (!((prevHasChang && nextHasQu) || (prevHasQu && nextHasChang)))
        return;
    patterns.push({
        name: '昌曲夹命',
        level: 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', prev.name, next.name],
        conditions: { required: ['文昌文曲分居命宫前后两宫'] },
        source: '《紫微斗数全书》',
    });
}
function detectKuiYueJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const okA = hasStar(prev, '天魁') && hasStar(next, '天钺');
    const okB = hasStar(prev, '天钺') && hasStar(next, '天魁');
    if (!okA && !okB)
        return;
    patterns.push({
        name: '魁钺夹命',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', prev.name, next.name],
        conditions: { required: ['天魁天钺分居命宫前后两宫'] },
        source: '《紫微斗数全书》',
    });
}
function detectShuangLuChaoYuan(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const sanFang = getSanFangPalaces(chart);
    let huaLuFound = false;
    let luCunFound = false;
    for (const p of sanFang) {
        if (p.stars.some(s => s.siHua === '禄'))
            huaLuFound = true;
        if (hasStar(p, '禄存'))
            luCunFound = true;
    }
    if (!huaLuFound || !luCunFound)
        return;
    patterns.push({
        name: '双禄朝垣',
        level: 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: sanFang.map(p => p.name),
        conditions: {
            required: ['化禄会照三方四正', '禄存会照三方四正'],
            breaking: hasShaInPalace(ming, SHA_KONG) ? ['命坐空劫（双禄遇空，财来财去）'] : undefined,
        },
        source: '《紫微斗数全书·双禄朝垣》',
    });
}
function detectSanQiJiaHui(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangPalaces = getSanFangPalaces(chart);
    let lu = false, quan = false, ke = false;
    for (const p of sanFangPalaces) {
        for (const s of p.stars) {
            if (s.siHua === '禄')
                lu = true;
            if (s.siHua === '权')
                quan = true;
            if (s.siHua === '科')
                ke = true;
        }
    }
    if (!(lu && quan && ke))
        return;
    patterns.push({
        name: '三奇加会',
        level: 'excellent',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: sanFangPalaces.map(p => p.name),
        conditions: { required: ['化禄、化权、化科三吉化齐会命宫三方四正'] },
        source: '《紫微斗数全书·三奇加会》',
    });
}
function detectHuaLuRuMing(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const huaLuStar = ming.stars.find(s => s.siHua === '禄' && s.type === 'major');
    if (!huaLuStar)
        return;
    patterns.push({
        name: `${huaLuStar.name}化禄入命`,
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: [`${huaLuStar.name}化禄坐命宫`] },
        source: '《紫微斗数全书》',
    });
}
function detectHuaJiRuMingQian(chart: ZiweiChart, patterns: Pattern[]) {
    const qianBranch = (chart.mingGongBranch + 6) % 12;
    for (const palace of chart.palaces) {
        if (palace.branch !== chart.mingGongBranch && palace.branch !== qianBranch)
            continue;
        const jiStar = palace.stars.find(s => s.siHua === '忌' && s.type === 'major');
        if (!jiStar)
            continue;
        const inMing = palace.branch === chart.mingGongBranch;
        patterns.push({
            name: `${jiStar.name}化忌入${inMing ? '命' : '迁'}`,
            level: 'caution',
            description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
            palaces: [palace.name],
            conditions: { required: [`${jiStar.name}化忌坐${inMing ? '命' : '迁'}宫`] },
            source: '《紫微斗数全书》',
        });
    }
}
function detectYangTuoJiaJi(chart: ZiweiChart, patterns: Pattern[]) {
    for (const palace of chart.palaces) {
        const jiStar = palace.stars.find(s => s.siHua === '忌');
        if (!jiStar)
            continue;
        if (palace.branch !== chart.mingGongBranch)
            continue;
        const { prev, next } = getJiaPalaces(chart, palace.branch);
        if (!prev || !next)
            continue;
        const aPrev = hasStar(prev, '擎羊') && hasStar(next, '陀罗');
        const aNext = hasStar(prev, '陀罗') && hasStar(next, '擎羊');
        if (!aPrev && !aNext)
            continue;
        patterns.push({
            name: '羊陀夹忌',
            level: 'caution',
            description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
            palaces: ['命宫', prev.name, next.name],
            conditions: { required: ['化忌坐命', '擎羊陀罗分居命宫前后两宫'] },
            source: '《紫微斗数骨髓赋·羊陀夹忌》',
        });
        return;
    }
}
function detectHuoLingJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const okA = hasStar(prev, '火星') && hasStar(next, '铃星');
    const okB = hasStar(prev, '铃星') && hasStar(next, '火星');
    if (!okA && !okB)
        return;
    patterns.push({
        name: '火铃夹命',
        level: 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', prev.name, next.name],
        conditions: { required: ['火星铃星分居命宫前后两宫'] },
        source: '《紫微斗数全书》',
    });
}
function detectKongJieJiaMing(chart: ZiweiChart, patterns: Pattern[]) {
    const { prev, next } = getJiaPalaces(chart, chart.mingGongBranch);
    if (!prev || !next)
        return;
    const okA = hasStar(prev, '地空') && hasStar(next, '地劫');
    const okB = hasStar(prev, '地劫') && hasStar(next, '地空');
    if (!okA && !okB)
        return;
    patterns.push({
        name: '空劫夹命',
        level: 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫', prev.name, next.name],
        conditions: { required: ['地空地劫分居命宫前后两宫'] },
        source: '《紫微斗数全书》',
    });
}
function detectLianShaYang(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!(sanFangSet.has('廉贞') && sanFangSet.has('七杀') && sanFangSet.has('擎羊')))
        return;
    patterns.push({
        name: '廉杀羊',
        level: 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['廉贞、七杀、擎羊三星会照三方四正'] },
        source: '《紫微斗数全书·廉杀羊》',
    });
}
function detectJuHuoYang(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!(sanFangSet.has('巨门') && sanFangSet.has('火星') && sanFangSet.has('擎羊')))
        return;
    patterns.push({
        name: '巨火羊',
        level: 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['巨门、火星、擎羊三星会照三方四正'] },
        source: '《紫微斗数骨髓赋·巨火羊》',
    });
}
function detectLingChangTuoWu(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!(sanFangSet.has('铃星') && sanFangSet.has('文昌') && sanFangSet.has('陀罗') && sanFangSet.has('武曲')))
        return;
    patterns.push({
        name: '铃昌陀武',
        level: 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['铃星、文昌、陀罗、武曲四星会照三方四正'] },
        source: '《紫微斗数骨髓赋·铃昌陀武》',
    });
}
function detectMaTouDaiJian(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    if (ming.branch !== 6)
        return;
    if (!hasStar(ming, '擎羊'))
        return;
    const required = ['擎羊于午宫坐命'];
    const bonus: string[] = [];
    const breaking: string[] = [];
    if (sanFangAllStars(chart).has('七杀') || sanFangAllStars(chart).has('破军'))
        bonus.push('再会七杀或破军（武职大贵）');
    if (sanFangAllStars(chart).has('天魁') || sanFangAllStars(chart).has('天钺'))
        bonus.push('魁钺加照');
    patterns.push({
        name: '马头带箭',
        level: bonus.length ? 'good' : 'caution',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required, bonus },
        source: '《紫微斗数骨髓赋·马头带箭》',
    });
}
function detectLuCunShouShen(chart: ZiweiChart, patterns: Pattern[]) {
    const luCunPalace = findStarPalace(chart, '禄存');
    if (!luCunPalace)
        return;
    const inMing = luCunPalace.branch === chart.mingGongBranch;
    const inShen = luCunPalace.branch === chart.shenGongBranch;
    if (!inMing && !inShen)
        return;
    patterns.push({
        name: inMing ? '禄存守命' : '禄存守身',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [inMing ? '命宫' : '身宫'],
        conditions: { required: [inMing ? '禄存入命宫' : '禄存入身宫'] },
        source: '《紫微斗数全书·禄存星》',
    });
}
function detectTianMaRuMing(chart: ZiweiChart, patterns: Pattern[]) {
    const tianMaPalace = findStarPalace(chart, '天马');
    if (!tianMaPalace)
        return;
    const inMing = tianMaPalace.branch === chart.mingGongBranch;
    const inQian = tianMaPalace.branch === ((chart.mingGongBranch + 6) % 12);
    if (!inMing && !inQian)
        return;
    patterns.push({
        name: inMing ? '天马入命' : '天马在迁',
        level: 'neutral',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: [tianMaPalace.name],
        conditions: { required: [inMing ? '天马入命宫' : '天马入迁移宫'] },
        source: '《紫微斗数全书·天马星》',
    });
}
function detectHuaLuRuCai(chart: ZiweiChart, patterns: Pattern[]) {
    const cai = chart.palaces.find(p => p.name === '财帛');
    if (!cai)
        return;
    const luStar = cai.stars.find(s => s.type === 'major' && s.siHua === '禄');
    if (!luStar)
        return;
    patterns.push({
        name: '化禄入财',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['财帛'],
        conditions: { required: [`${luStar.name}化禄入财帛宫`] },
        source: '《紫微斗数全书·四化论》',
    });
}
function detectHuaQuanRuGuan(chart: ZiweiChart, patterns: Pattern[]) {
    const guan = chart.palaces.find(p => p.name === '官禄');
    if (!guan)
        return;
    const quanStar = guan.stars.find(s => s.type === 'major' && s.siHua === '权');
    if (!quanStar)
        return;
    patterns.push({
        name: '化权入官',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['官禄'],
        conditions: { required: [`${quanStar.name}化权入官禄宫`] },
        source: '《紫微斗数全书·四化论》',
    });
}
function detectHuaKeRuMingShen(chart: ZiweiChart, patterns: Pattern[]) {
    const ming = chart.palaces.find(p => p.branch === chart.mingGongBranch);
    const shen = chart.palaces.find(p => p.branch === chart.shenGongBranch);
    const target = [ming, shen].filter((p): p is Palace => Boolean(p));
    for (const p of target) {
        const keStar = p.stars.find(s => s.type === 'major' && s.siHua === '科');
        if (!keStar)
            continue;
        const isMing = p.branch === chart.mingGongBranch;
        patterns.push({
            name: isMing ? '化科入命' : '化科入身',
            level: 'good',
            description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
            palaces: [isMing ? '命宫' : '身宫'],
            conditions: { required: [`${keStar.name}化科入${isMing ? '命' : '身'}宫`] },
            source: '《紫微斗数全书·四化论》',
        });
        return;
    }
}
function detectJiYueTongLiangPartial(chart: ZiweiChart, ming: Palace, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    const has = ['天机', '太阴', '天同', '天梁'].filter(s => sanFangSet.has(s));
    if (has.length !== 3)
        return;
    const missing = ['天机', '太阴', '天同', '天梁'].filter(s => !sanFangSet.has(s));
    patterns.push({
        name: '机月同梁三星会',
        level: 'neutral',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: getSanFangPalaces(chart).filter(p => has.some(s => getMajorStarNames(p).includes(s))).map(p => p.name),
        conditions: { required: [`三方四正会${has.join('、')}（机月同梁缺${missing.join('、')}）`] },
        source: '《紫微斗数全书·机月同梁格》',
    });
    void ming;
}
function detectChangQuTongHui(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!sanFangSet.has('文昌') || !sanFangSet.has('文曲'))
        return;
    const ming = chart.palaces.find(p => p.branch === chart.mingGongBranch);
    if (!ming)
        return;
    const inMing = hasStar(ming, '文昌') && hasStar(ming, '文曲');
    patterns.push({
        name: inMing ? '昌曲坐命' : '昌曲同会',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['文昌、文曲同会命宫三方四正'] },
        source: '《紫微斗数全书·文星论》',
    });
}
function detectFuBiTongHui(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!sanFangSet.has('左辅') || !sanFangSet.has('右弼'))
        return;
    patterns.push({
        name: '辅弼同会',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['左辅、右弼同会命宫三方四正'] },
        source: '《紫微斗数全书·辅弼论》',
    });
}
function detectKuiYueTongHui(chart: ZiweiChart, patterns: Pattern[]) {
    const sanFangSet = sanFangAllStars(chart);
    if (!sanFangSet.has('天魁') || !sanFangSet.has('天钺'))
        return;
    patterns.push({
        name: '魁钺同会',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['天魁、天钺同会命宫三方四正'] },
        source: '《紫微斗数全书·魁钺论》',
    });
}
function detectKeQuanShuangHui(chart: ZiweiChart, patterns: Pattern[]) {
    const sfPalaces = getSanFangPalaces(chart);
    let hasKe = false, hasQuan = false;
    for (const p of sfPalaces) {
        for (const s of p.stars) {
            if (s.type === 'major' && s.siHua === '科')
                hasKe = true;
            if (s.type === 'major' && s.siHua === '权')
                hasQuan = true;
        }
    }
    if (!hasKe || !hasQuan)
        return;
    patterns.push({
        name: '科权双会',
        level: 'good',
        description: "\u6839\u636E\u661F\u66DC\u4F4D\u7F6E\u4E0E\u683C\u5C40\u6761\u4EF6\u8FDB\u884C\u7684\u4F20\u7EDF\u89C4\u5219\u5339\u914D\u3002",
        palaces: ['命宫'],
        conditions: { required: ['化科、化权同会命宫三方四正'] },
        source: '《紫微斗数全书·四化会照》',
    });
}
export function detectPatterns(chart: ZiweiChart): Pattern[] {
    const patterns: Pattern[] = [];
    const ming = chart.palaces.find(p => p.branch === chart.mingGongBranch);
    if (!ming)
        return patterns;
    detectJunChenQingHui(chart, ming, patterns);
    detectZiFu(chart, ming, patterns);
    detectFuXiangChaoYuan(chart, ming, patterns);
    detectYangLiangChangLu(chart, ming, patterns);
    detectHuoTanLingTan(chart, ming, patterns);
    detectWuTan(chart, ming, patterns);
    detectShaPoLang(chart, ming, patterns);
    detectJiYueTongLiang(chart, ming, patterns);
    detectLianXiang(chart, patterns);
    detectWuQiSha(chart, patterns);
    detectTongLiang(chart, patterns);
    detectRiYueTongGong(chart, patterns);
    detectRiYueJiaMing(chart, patterns);
    detectJuRiTongGong(chart, patterns);
    detectShiZhongYinYu(chart, ming, patterns);
    detectMingZhuChuHai(chart, ming, patterns);
    detectZiWeiInMing(chart, ming, patterns);
    detectFuBiJiaMing(chart, patterns);
    detectChangQuJiaMing(chart, patterns);
    detectKuiYueJiaMing(chart, patterns);
    detectShuangLuChaoYuan(chart, ming, patterns);
    detectSanQiJiaHui(chart, patterns);
    detectHuaLuRuMing(chart, ming, patterns);
    detectHuaJiRuMingQian(chart, patterns);
    detectYangTuoJiaJi(chart, patterns);
    detectHuoLingJiaMing(chart, patterns);
    detectKongJieJiaMing(chart, patterns);
    detectLianShaYang(chart, patterns);
    detectJuHuoYang(chart, patterns);
    detectLingChangTuoWu(chart, patterns);
    detectMaTouDaiJian(chart, ming, patterns);
    detectLuCunShouShen(chart, patterns);
    detectTianMaRuMing(chart, patterns);
    detectHuaLuRuCai(chart, patterns);
    detectHuaQuanRuGuan(chart, patterns);
    detectHuaKeRuMingShen(chart, patterns);
    detectJiYueTongLiangPartial(chart, ming, patterns);
    detectChangQuTongHui(chart, patterns);
    detectFuBiTongHui(chart, patterns);
    detectKuiYueTongHui(chart, patterns);
    detectKeQuanShuangHui(chart, patterns);
    return patterns;
}
export function getMingGongSummary(chart: ZiweiChart): {
    stars: string[];
    keywords: string[];
    nature: string;
} {
    const mingPalace = chart.palaces.find(p => p.branch === chart.mingGongBranch);
    if (!mingPalace)
        return { stars: [], keywords: [], nature: '' };
    const majorStars = mingPalace.stars.filter(s => s.type === 'major');
    const starNames = majorStars.map(s => s.name);
    const keywordMap: Record<string, string[]> = {
        '紫微': ['尊贵', '独立', '领导'],
        '天机': ['智慧', '机变', '善谋'],
        '太阳': ['阳刚', '官贵', '慷慨'],
        '武曲': ['财富', '刚毅', '果断'],
        '天同': ['温和', '享福', '随缘'],
        '廉贞': ['才艺', '桃花', '多变'],
        '天府': ['财库', '稳重', '保守'],
        '太阴': ['柔美', '财富', '细腻'],
        '贪狼': ['欲望', '桃花', '多才'],
        '巨门': ['善辩', '多思', '口才'],
        '天相': ['辅佐', '行政', '稳健'],
        '天梁': ['荫护', '医药', '长辈'],
        '七杀': ['将星', '果决', '孤克'],
        '破军': ['开创', '变动', '破旧'],
    };
    const natureMap: Record<string, string> = {
        '紫微': '帝王星', '天机': '智慧星', '太阳': '贵人星',
        '武曲': '财帛星', '天同': '福德星', '廉贞': '桃花星',
        '天府': '财库星', '太阴': '财富星', '贪狼': '桃花星',
        '巨门': '是非星', '天相': '印绶星', '天梁': '荫庇星',
        '七杀': '将帅星', '破军': '变动星',
    };
    const keywords = starNames.flatMap(n => keywordMap[n] ?? []).slice(0, 5);
    const nature = starNames.length > 0 ? (natureMap[starNames[0]] ?? '') : '空宫';
    return { stars: starNames, keywords, nature };
}
