/** Narrow no-write conversation recognition; ambiguous commands retain the existing plan checks. */
export function isConversationOnly(prompt: string) {
  return (
    /你好|你能.*(?:做什么|帮.*什么)|你觉得|怎么样|怎么看|点评|讨论|分析|建议|看看.*人设|执行详情|技术追踪/i.test(
      prompt,
    ) &&
    !/(?:创建|新建|添加|建立|连接|修改|更新|删除|写入|保存|导入|恢复|重命名|移动|执行计划|搭建)/.test(
      prompt,
    )
  );
}
