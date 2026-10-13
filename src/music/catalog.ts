export const musicCourses = [
  {
    id: 'foundations',
    title: 'EDM 从零开始：乐理、声音与 Live 12',
    detail: '六个基础实验，从节拍、和弦到混音。',
  },
  {
    id: 'bigroom',
    title: 'Big Room：从动机到 Drop',
    detail: '四拍底鼓、简洁 Lead 与强烈的段落反差。',
  },
  {
    id: 'progressive',
    title: 'Progressive House：旋律与渐进发展',
    detail: 'Festival 与渐进编排对照，和声、氛围与层叠。',
  },
  {
    id: 'bounce',
    title: 'Melbourne Bounce：让贝斯弹跳',
    detail: '反拍、短促音色与鼓贝斯间的空隙。',
  },
  {
    id: 'dnb',
    title: 'DnB：Broken Beat 与低频空间',
    detail: '快速鼓组、Ghost Note、Sub 与 Reese Bass。',
  },
] as const;
export type MusicCourseId = (typeof musicCourses)[number]['id'];
