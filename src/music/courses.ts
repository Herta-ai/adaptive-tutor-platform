import { Courses } from '../domain/courses.js';
import { now, uuid } from '../storage/database.js';
import {
  musicConfig,
  buildUpAutomation,
  type Genre,
  type MusicConfig,
  type MusicNote,
} from './model.js';
import type { LessonDraft } from '../contracts/v1.js';

import { musicCourses, type MusicCourseId } from './catalog.js';
export { musicCourses, type MusicCourseId } from './catalog.js';
type Lesson = {
  title: string;
  panel: string;
  config: Partial<MusicConfig>;
  explanation: string;
  worked: string;
  task: string;
  question: string;
  options: [string, string, string];
  answer: number;
  reason: string;
  live: string;
  performance?: MusicNote[];
};
const note = (
  pitch: number,
  beat: number,
  instrument: MusicNote['instrument'] = 'piano',
): MusicNote => ({
  id: `${instrument}-${beat}-${pitch}`,
  pitch,
  beat,
  duration: 0.5,
  instrument,
  velocity: 96,
});
const foundation: Lesson[] = [
  {
    title: '节拍、音阶与键盘',
    panel: 'keyboard',
    config: { preset: 'scale', bpm: 90 },
    explanation:
      'BPM 表示每分钟的拍数。4/4 拍每小节有四个四分音符拍；八分音符把一拍分成两份，十六分音符分成四份。速度改变时间长度，不改变音高。十二平均律中每个半音的频率比为 2^(1/12)，A4 为 440 Hz。C 大调为 C D E F G A B，半音距离是 2、2、1、2、2、2、1；自然小调为 2、1、2、2、1、2、2。切换大小调，边听边看第三、六、七级的变化。',
    worked:
      '120 BPM 时一拍为 0.5 秒，一小节为 2 秒。C 到 G 相距 7 个半音，是纯五度；C 到高八度 C 相距 12 个半音，频率翻倍。',
    task: '先用节拍器数四拍，再弹 C D E G。分别用简谱、五线谱与卷帘找到相同的音；用“逐拍”确认起音位置。',
    question: '改变 BPM，保持 MIDI 音高不变时，什么会改变？',
    options: ['音符对应的时间间隔', '音符的音高', '音阶的半音结构'],
    answer: 0,
    reason: 'BPM 改变拍到秒的映射，不改变十二平均律的音高。',
    live: '新建 Live Set，将顶部 Tempo 设为 90。创建 MIDI 轨并载入 Drift，双击空的 Session 槽创建片段；在 MIDI 编辑器画 C3、D3、E3、G3 四个四分音符，再把 Tempo 改为 120。注意 Live 用 C3 标记 MIDI 60，本平台采用科学音高记号 C4=MIDI 60；导入 MIDI 的实际音高一致。',
  },
  {
    title: '和弦、转位与旋律动机',
    panel: 'harmony',
    config: { preset: 'chords', bpm: 100 },
    explanation:
      '大三和弦由根音、大三度、纯五度组成；小三和弦把三音降低半音。转位将最低音移高八度，改变排列但保留和弦身份。声部连接优先保留共同音、让其他音短距离移动。旋律可从和弦音出发：强拍落在稳定音，经过音连接它们；重复一个短动机，再改变尾音形成问答。',
    worked:
      'C 大三和弦 C E G 的第一转位为 E G C。C→F→G→C 可先把共同音留在原位。C E G E 是四音动机，第二次改为 C E D C，形成回到主音的回答。',
    task: '切换三个转位，观察音高变化；独奏钢琴后编辑一个音，听辨稳定与张力。先写和弦，再为它写四音动机。',
    question: '把 C E G 改成 E G C，和弦发生了什么变化？',
    options: ['变成小三和弦', '成为第一转位，身份仍是 C 大三和弦', '变成 G 大三和弦'],
    answer: 1,
    reason: '组成音不变，最低音从根音变成三音。',
    live: '创建 MIDI 轨并载入 Analog 或 Drift。画 C、E、G 叠置的长音，复制片段，将最低 C 上移一个八度。另建旋律轨，写四音动机；同时循环播放两个片段，保留共同音并调整跳进。',
    performance: [note(60, 0), note(64, 0), note(67, 0), note(60, 2), note(62, 3)],
  },
  {
    title: '鼓格、重音与律动',
    panel: 'rhythm',
    config: { preset: 'bigroom', bpm: 100, muted: ['bass', 'lead', 'pad'] },
    explanation:
      '四拍底鼓在每个四分拍落下，军鼓或 Clap 常在第二、第四拍。踩镲可填八分或十六分格。切分把重音放在弱拍或拍间；Swing 推迟交替细分，不是随意改变所有起音。Ghost Note 保持较小力度，让主军鼓仍清晰。Fill 通常在段落结尾制造期待，下一段落要留出空间。',
    worked:
      '一小节 16 格中，底鼓放第 1、5、9、13 格，军鼓放第 5、13 格。把踩镲力度交替设为 95 与 65，可建立强弱关系。',
    task: '用鼓格改变第一小节。依次独奏底鼓、军鼓、踩镲，比较加入 Ghost Note 前后；再用鼓垫跟随四拍预备录制。',
    question: '4/4 拍十六分格中，第二拍对应哪一格？',
    options: ['第 2 格', '第 4 格', '第 5 格'],
    answer: 2,
    reason: '每拍四格，第二拍从第 5 格开始。',
    live: '在 MIDI 轨载入 Drum Rack，将课程 Kick、Snare、Hat WAV 拖到三个鼓垫。用 1/16 网格写节奏，在 Velocity 编辑区降低装饰音力度。使用 Groove Pool 对比 Straight 与 Swing；不要直接把所有音符随机移动。',
    performance: [
      note(36, 0, 'kick'),
      note(38, 1, 'snare'),
      note(36, 2, 'kick'),
      note(38, 3, 'snare'),
    ],
  },
  {
    title: '合成音色：从 Pluck 到 Pad',
    panel: 'synth',
    config: { preset: 'progressive', solo: 'lead', bpm: 110 },
    explanation:
      '振荡器决定初始谐波：正弦适合 Sub，锯齿适合丰富的 Lead。多振荡器轻微失谐产生拍频和宽厚感，过多会让低频不稳定。低通滤波器削弱高频；共振强调截止附近的频率。ADSR 是起音、衰减、持续电平与松键释放，Sustain 不是时间。LFO 以低频周期改变截止、音量或音高，速率与深度是两个不同维度。',
    worked:
      'Pluck：Attack 0.01 s、Decay 0.2 s、Sustain 0.15、Release 0.15 s。Pad：Attack 0.6 s、Decay 0.8 s、Sustain 0.7、Release 1.2 s。将 LFO 从 0.5 调至 4 Hz，听调制变快；再只增加深度，听变化范围变大。',
    task: '保持音符不变，分别制作 Pluck、Pad 和 Sub。每次只改一个参数，观察真实波形、频谱与 ADSR 曲线。',
    question: 'ADSR 中 Sustain 控制什么？',
    options: ['松键后的持续时间', '按住时的持续电平', '振荡器频率'],
    answer: 1,
    reason: 'Sustain 是电平；Release 才描述松键后消失的时间。',
    live: '用 Drift 或 Analog 开始：选择锯齿、调低滤波截止，按课程参数调整音量包络，随后增加滤波包络或 LFO 调制。进阶（Suite）：用 Wavetable 比较波表位置调制，用 Operator 学习 FM，用 Meld 研究双音色调制；这些扩展不是基础课前置条件。',
  },
  {
    title: '从循环到完整编排',
    panel: 'arrangement',
    config: { preset: 'progressive', arrangement: true },
    explanation:
      '循环提供素材，段落需要发展。Intro 建立节拍与氛围；发展段加入和声或动机；Build-up 通过密度、滤波、上升音和短暂停顿积累期待；Drop 释放核心节奏与主题。能量变化不等于单纯加大音量。用自动化渐变参数，用删减制造反差；不同曲风的段落长度与密度可不同。',
    worked:
      '实验用四个四小节段落：鼓进入→加入贝斯与和声→暂时抽掉贝斯→完整层次回归。成曲时可将同一逻辑扩展为 8/16/32 小节，并增加 Breakdown 与 Outro。',
    task: '先逐段试听，再独奏各轨看何时进入。指出一处“增加”与一处“删减”的发展手法；在 Live 中完成自己的 Intro、主题、Breakdown、Build-up、Drop 和 Outro。',
    question: '怎样在不增加总音量的前提下增强 Drop 的反差？',
    options: ['让所有轨一直满密度播放', '只把主输出推到削波', '在进入 Drop 前减少低频或留出停顿'],
    answer: 2,
    reason: '先减少再恢复能量可形成结构反差；削波不是编曲发展。',
    live: '先在 Session View 建立鼓、贝斯、和弦、旋律片段并试组合；将选定片段拖入 Arrangement View。用 Locator 标记段落，展开 Automation，画滤波截止或发送量变化。先完成段落，再细化音色，避免一直停在一个循环。',
  },
  {
    title: '混音、侧链与空间',
    panel: 'mixing',
    config: { preset: 'bounce', sidechain: 0.7 },
    explanation:
      '先平衡音量，再处理频率与动态。dBFS 的 0 dB 是数字满刻度，需要为叠加保留余量。EQ 用中心频率、增益与 Q 改变频谱；先听清问题再决定削减或提升。压缩器用阈值和比例压低超过阈值的动态，Attack/Release 决定响应。真正的侧链由另一轨信号触发检测：底鼓到来时暂时压低贝斯/和声；它不同于固定画一个音量波形。混响发送建立空间，延迟构建重复，声像与共同总线帮助分层。',
    worked:
      '输入 -6 dB、阈值 -18 dB、比例 3:1 时，静态输出为 -18 + 12/3 = -14 dB（未加补偿增益）。实验侧链有独立底鼓检测输入；静音底鼓后不会凭空出现压低。',
    task: '旁通并开启效果，启用 RMS 响度匹配再判断清晰度。独奏贝斯只能检查音色；最终必须回到整曲判断底鼓与贝斯的关系。作品自评关注层次、低频与段落，不以单一分数判断审美。',
    question: '外部侧链压缩的检测信号来自哪里？',
    options: ['被选作触发源的另一轨，例如底鼓', '固定的曲风名称', '只来自当前轨的音高'],
    answer: 0,
    reason: '侧链用触发轨的真实信号控制增益衰减。',
    live: '在 Mixer 先调轨道电平，用 EQ Eight 清理有证据的冲突。在贝斯轨插入 Compressor，展开 Sidechain 并选择 Kick 轨为 Audio From，调节 Threshold/Ratio/Attack/Release。建 Return 轨放 Reverb 或 Delay，通过 Send 共享空间；用 Utility 检查单声道。Suite 扩展：Roar 用于失真与动态调制，Max for Live 用于进一步的控制实验。',
  },
];
const style = {
  bigroom: {
    name: 'Big Room',
    bpm: 128,
    rhythm:
      '四拍底鼓与第二、第四拍的军鼓建立稳定框架。用少量重复音构成 Lead 动机，为底鼓和长尾低频留空间。',
    sound: 'Lead 可从锯齿、轻度失谐和短包络开始，先控制中高频，再加空间；低频层保持清晰。',
    form: 'Build-up 逐步增加军鼓密度、打开滤波，Drop 前留半拍空隙；Drop 回到简洁动机。',
  },
  progressive: {
    name: 'Progressive House',
    bpm: 126,
    rhythm:
      '让和弦进行承担情绪，旋律在和弦音与经过音间运动。保持共同音，避免每次换和弦都让所有声部大幅跳动。',
    sound:
      'Festival 示例突出宽厚 Lead 与分层和弦；渐进示例采用较轻的 Pluck、缓慢 Pad 和细微调制，靠纹理演变推进。',
    form: '以 8/16 小节发展动机；改变配器、音域与自动化，保留可识别主题。对比 Festival 的明显释放与渐进编排的持续变化。',
  },
  bounce: {
    name: 'Melbourne Bounce',
    bpm: 128,
    rhythm:
      '在四拍底鼓之间放反拍贝斯，用较短音符产生弹跳。先固定底鼓，检查每个贝斯起音是在拍上还是拍间。',
    sound:
      '短 Attack、较短 Decay、适度 Sustain 与 Release，让贝斯尾部不过度遮挡下一次底鼓。侧链只是辅助，音符长度与编排同样重要。',
    form: '通过问答动机、单拍停顿和短 Fill 推进段落；避免每四小节原封不动复制。',
  },
  dnb: {
    name: 'DnB',
    bpm: 174,
    rhythm:
      '以第二、第四拍军鼓为支点，底鼓使用不对称 Broken Beat。Ghost Note 与较细的踩镲增加滚动感，但主重音保持清晰。',
    sound:
      'Sub 负责稳定低频，Reese 用失谐锯齿与滤波调制产生运动。分清音色层的职责，低频尽量稳定；宽度主要来自较高频的层。',
    form: '先用慢速检查切片起音，再回到 174 BPM。Breakdown 减少鼓组，回归时通过鼓型变奏与低频主题建立连贯性。',
  },
};
function genreLessons(genre: Genre): Lesson[] {
  const s = style[genre];
  return [
    {
      title: `${s.name}：节奏与动机`,
      panel: 'rhythm',
      config: { preset: genre, bpm: s.bpm },
      explanation: s.rhythm + ' 本示例为原创四小节教学片段，BPM 是起点，不是曲风的唯一判据。',
      worked:
        genre === 'dnb'
          ? '第一小节底鼓在第 1 拍与第 3 拍后半拍，军鼓在第 2、4 拍；第 3 拍末加入较弱装饰音。'
          : '每小节先数 1、2、3、4，再把拍间数成“与”。逐个独奏声部，找到它与底鼓的相对位置。',
      task: '慢放、独奏并修改鼓格；保留一种特征，再主动改变一种特征。写出你保留了什么，而不只记住某个 BPM。',
      question: `${s.name} 的示例中，判断律动最应关注什么？`,
      options: ['起音位置、强弱与声部关系', '只看工程文件大小', '只看软件品牌'],
      answer: 0,
      reason: '律动来自时间和力度关系，曲风名称与软件不能代替听觉判断。',
      live: 'Live 12 Standard：导入本课 MIDI，检查顶部 Tempo；将鼓事件放到 Drum Rack，旋律放到 Drift。Session View 循环四小节，用 Solo 拆听，在 MIDI 编辑器修改起音与 Velocity。DnB 的音频循环可在 Simpler 的 Slice 模式中按瞬态重组，先核对 Warp 拍点，勿把速度变化误当成新鼓型。',
      performance: [
        note(36, 0, 'kick'),
        note(38, 1, 'snare'),
        note(36, 2.5, 'kick'),
        note(38, 3, 'snare'),
      ],
    },
    {
      title: `${s.name}：音色与混音`,
      panel: 'mixing',
      config: {
        preset: genre,
        bpm: s.bpm,
        lfoDepth: genre === 'dnb' ? 900 : 150,
        detune: genre === 'dnb' ? 18 : 9,
      },
      explanation: s.sound + ' 把调制速率与深度分开研究；先平衡轨道音量，再尝试 EQ、压缩和空间。',
      worked:
        '先旁通效果记录主观清晰度，再只开启侧链；接着逐个加入 EQ 与空间。使用响度匹配，避免更响的版本天然占优。',
      task: '保存两个快照，对比同一动机的短促与持续音色。指出你听到的差别，并说明改变了哪个参数。',
      question: `${s.name} 混音试听时，为什么需要匹配响度？`,
      options: ['为了让所有轨完全相同', '避免把单纯更响误认为音色更好', '为了改变歌曲调性'],
      answer: 1,
      reason: '相近响度让频谱、动态和空间差异更容易客观比较。',
      live: 'Live 12 Standard：用 Drift/Analog 对应振荡器、滤波与包络；用 EQ Eight、Compressor、Reverb、Delay 对应混音链。底鼓送入贝斯 Compressor 的 Sidechain。记录你的参数与听感，不机械复制数值；两套实现的滤波器响应不会完全相同。Suite 扩展：Wavetable 的波表位置调制、Operator 的 FM，或 Roar 的频段失真。',
    },
    {
      title: `${s.name}：段落与成曲`,
      panel: 'arrangement',
      config: { preset: genre, bpm: s.bpm, arrangement: true },
      explanation:
        s.form +
        ' 用重复建立识别度，用变化推动注意力。完整作品还需要检查开头、结尾和段落之间的因果关系。',
      worked:
        '平台将四小节素材展成 16 小节结构示范。实际作品在 Live 扩展为自己的段落长度；Breakdown、Build-up 与 Drop 不必都保持相同密度。',
      task: '在 Live 完成一版从 Intro 到 Outro 的作品。自评：主题是否明确？每段为何进入？转场是否自然？低频是否互相遮挡？导出后休息再听，并写下三项修改。创作质量不由理论题分数代替。',
      question: `${s.name} 成曲时，哪种做法更能建立段落发展？`,
      options: [
        '只复制同一循环且不改变任何内容',
        '把所有轨一律推到最大音量',
        '保留动机，逐段改变配器、密度或自动化',
      ],
      answer: 2,
      reason: '动机维持连贯性，配器与动态变化推动段落。',
      live: 'Live 12 Standard：把 Session 中选好的片段放进 Arrangement，用 Locator 标记段落。画滤波与发送自动化，检查 Return 和主输出余量。File → Export Audio/Video，先导出 WAV 进行试听和存档；导出范围覆盖整曲与效果尾音。混音、创作与成品由你和导师讨论，不从工程操作次数推断掌握。',
    },
  ];
}
export function createMusicCourse(courses: Courses, id: MusicCourseId, requestId: string = uuid()) {
  const entry = musicCourses.find((c) => c.id === id);
  if (!entry) throw Error('未知音乐课程');
  const lessons = id === 'foundations' ? foundation : genreLessons(id);
  const store = courses.store;
  return store.command(`example.music.${id}`, requestId, {}, () => {
    const course = store.put('course', {
      id: uuid(),
      topic: entry.title,
      title: entry.title,
      goal: entry.detail,
      profile: {
        background: '零基础；使用 Ableton Live 12 Standard，Suite 为可选扩展',
        weeklyMinutes: 120,
        language: '中文',
      },
      revision: 1,
      status: 'draft',
      createdAt: now(),
    });
    courses.publishPlan(course.id, 1, {
      schemaVersion: '1.0',
      title: entry.title,
      summary: entry.detail,
      concepts: lessons.map((l, i) => ({ key: `c${i}`, label: l.title })),
      nodes: lessons.map((l, i) => ({
        key: `n${i}`,
        conceptKey: `c${i}`,
        title: l.title,
        objectives: [{ key: 'objective', description: `理解${l.title}的关键概念并复现参考实验` }],
        estimatedMinutes: 15,
      })),
      edges: lessons.slice(1).map((_, i) => ({ fromKey: `n${i}`, toKey: `n${i + 1}` })),
      sources: [],
    });
    store.list('node', course.id).forEach((node, index) => {
      const l = lessons[index],
        config = musicConfig.parse({
          ...l.config,
          ...(l.config.arrangement ? { filterAutomation: buildUpAutomation() } : {}),
        }),
        objectiveId = node.objectives[0].id;
      const doc: LessonDraft = {
        schemaVersion: '1.0',
        title: l.title,
        blocks: [
          {
            blockId: 'goal',
            type: 'markdown',
            role: 'goal',
            text: `本课目标：${node.objectives[0].description}。\n\n学习顺序：听示例 → 看变化 → 调参数 → 练习 → 在 Live 复现。`,
          },
          { blockId: 'explain', type: 'markdown', role: 'explanation', text: l.explanation },
          { blockId: 'worked', type: 'markdown', role: 'worked_example', text: l.worked },
          {
            blockId: 'music',
            type: 'music_lab',
            templateId: `music.${l.panel}`,
            templateVersion: 1,
            config,
            modelInfo: {
              mode: 'computed',
              assumptions: [
                '十二平均律 A4=440 Hz',
                '简化教学合成器；VCSL CC0 钢琴与鼓采样',
                '示例音符原创；不自动读取 Live 工程',
              ],
              units: { tempo: 'BPM', time: 'beat', gain: 'dB' },
              sourceIds: ['live-manual', 'vcsl'],
            },
            alt: `${l.title}的交互谱面、声音、轨道与参数`,
          },
          {
            blockId: 'live',
            type: 'markdown',
            role: 'worked_example',
            text: `### Ableton Live 12 操作卡\n\n**基础兼容 Standard；Suite 扩展会单独标注。**\n\n${l.live}\n\n**本课实践：**${l.task}\n\n**常见问题：**没有声音时先检查轨道设备、音频输出与监听；导入 MIDI 后确认 Tempo。Live 的 C3 与本平台 C4 都对应 MIDI 60。侧链没有效果时确认触发轨路由与阈值。\n\n示例下方可下载原创 MIDI 和 WAV 干声，音色采样使用 VCSL CC0。完整作品在 Live 保存与导出。`,
          },
          {
            blockId: 'recap',
            type: 'markdown',
            role: 'recap',
            text: `${l.reason}\n\n先预测再调整，每次只改变一个因素。自由实验不会增加掌握证据；下方正式题目只评估可明确判断的知识与起音。创意、音色偏好和作品完成质量采用自评与导师讨论。`,
          },
        ],
        exercises: [
          {
            key: 'concept',
            objectiveId,
            familyKey: `${id}-${index}-concept`,
            kind: 'single_choice',
            prompt: l.question,
            options: l.options.map((label, i) => ({ id: `o${i}`, label })),
            grading: { correctOptionId: `o${l.answer}` },
            explanation: l.reason,
          },
          {
            key: 'perform',
            objectiveId,
            familyKey: `${id}-${index}-performance`,
            kind: 'music_performance',
            prompt: '看谱并独立演奏：先数四拍预备，再在对应拍点触发音符或鼓件。试听示范属于提示。',
            score: {
              bpm: 90,
              notes: l.performance ?? [note(60, 0), note(62, 1), note(64, 2), note(67, 3)],
            },
            grading: { algorithm: 'onset-v1' },
            explanation:
              '按谱面的音高/鼓件和起音匹配。漏音、多弹和时间偏差会影响匹配率；力度、时值先作为描述性信息。',
          },
          {
            key: 'transfer',
            objectiveId,
            familyKey: `${id}-${index}-transfer`,
            kind: 'single_choice',
            prompt: `将“${l.title}”实验迁移到 Live 时，哪一种检查方法合理？`,
            options: [
              { id: 'a', label: '保持素材与响度可比，逐项修改，并验证实际听感' },
              { id: 'b', label: '更换所有参数后仅凭峰值大小判断效果' },
              { id: 'c', label: '只要完成操作次数，就能证明创作质量' },
            ],
            grading: { correctOptionId: 'a' },
            explanation: '控制比较条件、逐项验证，才能理解因果；操作次数不是创作品质或掌握证据。',
          },
        ],
        sources: [
          {
            id: 'live-manual',
            title: 'Ableton Live 12 官方手册',
            url: 'https://www.ableton.com/en/manual/welcome-to-live/',
            status: 'suggested',
            supportsBlockIds: ['live'],
          },
          {
            id: 'vcsl',
            title: 'Versilian Community Sample Library',
            url: 'https://github.com/sgossner/VCSL',
            status: 'suggested',
            license: 'CC0-1.0',
            supportsBlockIds: ['music'],
          },
        ],
        assetRefs: [],
      };
      if (['synth', 'mixing'].includes(l.panel)) {
        const synth = l.panel === 'synth';
        doc.exercises[2] = {
          key: 'parameters',
          objectiveId,
          familyKey: `${id}-${index}-parameters`,
          kind: 'parameter',
          prompt: synth
            ? '制作指定 Pluck：将 attack 设为 0.01 秒、sustain 设为 0.15。提交这两个参数（不是音色审美评分）。'
            : '设置指定侧链实验：sidechain 为 0.7，ratio 为 3。提交这两个参数，再在 Live 对照试听。',
          grading: {
            template: 'parameter_targets',
            blockId: 'music',
            targets: (synth
              ? [
                  ['attack', 0.01],
                  ['sustain', 0.15],
                ]
              : [
                  ['sidechain', 0.7],
                  ['ratio', 3],
                ]
            ).map(([key, expected]) => ({
              key: key as string,
              expected: expected as number,
              absTolerance: 0.001,
              relTolerance: 0,
            })),
          },
          explanation: '本题只检验指定参数；实际音色、混音审美和成曲使用听感比较与检查清单。',
        };
      }
      courses.publishLesson(node.id, doc, { runtime: 'builtin' });
    });
    return store.must('course', course.id);
  });
}
