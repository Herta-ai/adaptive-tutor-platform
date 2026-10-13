'use client';
import { useEffect, useRef, useState } from 'react';
import { pitchName } from '../music/model';

export type InputEvent = {
  pitch: number;
  velocity: number;
  on: boolean;
  drum: boolean;
  pedal?: boolean;
  timestamp?: number;
};
export function MusicInput({
  onInput,
  onInterrupt,
  disabled = false,
  highlighted = [],
}: {
  onInput: (event: InputEvent) => void;
  onInterrupt: () => void;
  disabled?: boolean;
  highlighted?: number[];
}) {
  const callback = useRef(onInput),
    interrupt = useRef(onInterrupt),
    inactive = useRef(disabled);
  callback.current = onInput;
  interrupt.current = onInterrupt;
  inactive.current = disabled;
  const [active, setActive] = useState<number[]>([]),
    [message, setMessage] = useState('未连接 MIDI'),
    [devices, setDevices] = useState<MIDIInput[]>([]),
    [device, setDevice] = useState('');
  const midi = useRef<MIDIAccess | null>(null),
    alive = useRef(true);
  const midiChanged = useRef<() => void>(() => {});
  const area = useRef<HTMLDivElement>(null);
  const [mapping, setMapping] = useState({ kick: 36, snare: 38, hat: 42 });
  const sendRef = useRef<
    (pitch: number, velocity: number, on: boolean, drum?: boolean, timestamp?: number) => void
  >(() => {});
  sendRef.current = (pitch, velocity, on, drum = false, timestamp = performance.now()) => {
    if (inactive.current) return;
    setActive((a) => (on ? [...new Set([...a, pitch])] : a.filter((p) => p !== pitch)));
    callback.current({ pitch, velocity, on, drum, timestamp });
  };
  const pressed = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    const keys = 'awsedftgyhujk';
    const down = (e: KeyboardEvent) => {
      if (!area.current?.closest('.music-lab')?.contains(document.activeElement)) return;
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
      )
        return;
      const index = keys.indexOf(e.key.toLowerCase());
      if (index < 0) return;
      e.preventDefault();
      pressed.current.add(e.key.toLowerCase());
      sendRef.current(60 + index, 96, true, false, e.timeStamp);
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!pressed.current.delete(key)) return;
      sendRef.current(60 + keys.indexOf(key), 0, false);
    };
    const stop = () => {
      pressed.current.clear();
      setActive([]);
      callback.current({ pitch: 0, velocity: 0, on: false, drum: false, pedal: false });
      interrupt.current();
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    const lab = area.current?.closest('.music-lab');
    const focusout = (event: Event) => {
      if (!lab?.contains((event as FocusEvent).relatedTarget as Node | null)) stop();
    };
    lab?.addEventListener('focusout', focusout);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
      lab?.removeEventListener('focusout', focusout);
      if (midi.current) {
        midi.current.removeEventListener('statechange', midiChanged.current);
      }
    };
  }, []);
  useEffect(() => {
    const input = devices.find((input) => input.id === device);
    if (!input) return;
    const handler = (event: MIDIMessageEvent) => {
      if (inactive.current) return;
      if (!area.current?.closest('.music-lab')?.contains(document.activeElement)) return;
      const [status, pitch, velocity] = event.data ?? [];
      const kind = status & 0xf0,
        drum = (status & 15) === 9;
      if (kind === 0xb0 && pitch === 64) {
        callback.current({
          pitch: 0,
          velocity: 0,
          on: false,
          drum: false,
          pedal: velocity >= 64,
        });
        return;
      }
      if (![0x80, 0x90].includes(kind)) return;
      let mapped = pitch;
      if (drum) {
        const index = Object.values(mapping).indexOf(pitch);
        if (index < 0) return;
        mapped = [36, 38, 42][index];
      }
      sendRef.current(mapped, velocity, kind === 0x90 && velocity > 0, drum, event.timeStamp);
    };
    input.addEventListener('midimessage', handler);
    return () => input.removeEventListener('midimessage', handler);
  }, [devices, device, mapping]);
  async function connect() {
    try {
      if (!navigator.requestMIDIAccess) throw Error('此浏览器不支持 MIDI；仍可使用网页琴键');
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (!alive.current) return;
      if (midi.current) midi.current.removeEventListener('statechange', midiChanged.current);
      midi.current = access;
      const refresh = () => {
        if (!alive.current) return;
        const inputs = [...access.inputs.values()].filter((i) => i.state === 'connected');
        setDevices(inputs);
        setDevice((previous) =>
          inputs.some((i) => i.id === previous) ? previous : (inputs[0]?.id ?? ''),
        );
        setMessage(inputs.length ? 'MIDI 已连接（通道 10 为鼓）' : '未发现 MIDI 输入设备');
      };
      midiChanged.current = () => {
        interrupt.current();
        setActive([]);
        refresh();
      };
      access.addEventListener('statechange', midiChanged.current);
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'MIDI 权限未获允许；可继续网页演奏');
    }
  }
  const key = (pitch: number, drum: boolean, label: string) => (
    <button
      key={pitch}
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={active.includes(pitch) || highlighted.includes(pitch)}
      className={
        drum ? 'music-pad' : [1, 3, 6, 8, 10].includes(pitch % 12) ? 'music-key black' : 'music-key'
      }
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        sendRef.current(pitch, 100, true, drum);
      }}
      onPointerUp={() => sendRef.current(pitch, 0, false, drum)}
      onPointerCancel={() => {
        sendRef.current(pitch, 0, false, drum);
        interrupt.current();
      }}
      onKeyDown={(e) => {
        if (['Enter', ' '].includes(e.key) && !e.repeat) {
          e.preventDefault();
          sendRef.current(pitch, 96, true, drum);
        }
      }}
      onKeyUp={(e) => {
        if (['Enter', ' '].includes(e.key)) {
          e.preventDefault();
          sendRef.current(pitch, 0, false, drum);
        }
      }}
    >
      {label}
    </button>
  );
  return (
    <div ref={area} className="music-input">
      <div className="music-keys" aria-label="可演奏键盘">
        {Array.from({ length: 13 }, (_, i) => key(60 + i, false, pitchName(60 + i)))}
      </div>
      <p className="music-help">
        电脑键盘 A W S E D F T G Y H U J K 对应 C4–C5；支持多点触控。实体 MIDI 可演奏其他音域。
      </p>
      <div className="music-controls">
        {key(36, true, 'Kick 底鼓')}
        {key(38, true, 'Snare 军鼓')}
        {key(42, true, 'Hi-hat 踩镲')}
        <button type="button" onClick={() => void connect()}>
          连接 MIDI
        </button>
        {devices.length > 0 && (
          <select
            aria-label="MIDI 设备"
            value={device}
            onChange={(e) => {
              onInterrupt();
              setDevice(e.target.value);
            }}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p role="status" className="music-help">
        {message}
      </p>
      {devices.length > 0 && (
        <details>
          <summary>电子鼓映射</summary>
          {Object.entries(mapping).map(([name, pitch]) => (
            <label key={name}>
              {name}
              <input
                aria-label={`${name} MIDI 音符`}
                type="number"
                min={0}
                max={127}
                value={pitch}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0 && n <= 127) {
                    if (
                      Object.entries(mapping).some(
                        ([other, value]) => other !== name && value === n,
                      )
                    ) {
                      setMessage('鼓件映射不能使用重复音符');
                      return;
                    }
                    onInterrupt();
                    setMapping((m) => ({ ...m, [name]: n }));
                  }
                }}
              />
            </label>
          ))}
        </details>
      )}
    </div>
  );
}
