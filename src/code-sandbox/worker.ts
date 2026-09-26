import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
import initSqlJs from 'sql.js';
import { loadPyodide } from 'pyodide';

type Init = {
  runId: string;
  language: 'javascript' | 'python' | 'sql';
  source: string;
  input: string;
  files: Record<string, ArrayBuffer>;
};
self.onmessage = async ({ data }: MessageEvent<Init>) => {
  const { runId, language, source, input, files } = data;
  let output = '';
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    self.postMessage({ runId, type, ...extra });
  const print = (value: unknown) => {
    const line = String(value);
    if (output.length + line.length > 65536) throw Error('输出超过 64 KiB');
    output += line + '\n';
  };
  try {
    if (source.length > 16384) throw Error('源码超过 16 KiB');
    // The frame's CSP forbids real networking. This fixed map is only runtime data, never a URL proxy.
    self.fetch = async (resource: RequestInfo | URL) => {
      const name = String(resource);
      const prefix = 'https://runtime.invalid/';
      if (!name.startsWith(prefix) || !Object.hasOwn(files, name.slice(prefix.length)))
        throw Error('NETWORK_DENIED');
      const key = name.slice(prefix.length);
      return new Response(files[key], {
        headers: {
          'content-type': key.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        },
      });
    };
    if (language === 'javascript') {
      const module = await newQuickJSWASMModule(
        newVariant(RELEASE_SYNC, {
          wasmBinary: files['quickjs.wasm'],
          wasmLocation: 'https://runtime.invalid/quickjs.wasm',
        }),
      );
      const runtime = module.newRuntime();
      runtime.setMemoryLimit(32 * 1024 * 1024);
      runtime.setMaxStackSize(512 * 1024);
      const deadline = Date.now() + 2000;
      runtime.setInterruptHandler(() => Date.now() > deadline);
      const vm = runtime.newContext();
      try {
        const log = vm.newFunction('log', (...args) =>
          print(
            args
              .map((a) => {
                const value = vm.dump(a);
                return typeof value === 'string' ? value : JSON.stringify(value);
              })
              .join(' '),
          ),
        );
        const consoleHandle = vm.newObject();
        vm.setProp(consoleHandle, 'log', log);
        vm.setProp(vm.global, 'console', consoleHandle);
        vm.setProp(vm.global, 'print', log);
        log.dispose();
        consoleHandle.dispose();
        const inputHandle = vm.newString(input);
        vm.setProp(vm.global, 'input', inputHandle);
        inputHandle.dispose();
        send('ready');
        const result = vm.evalCode(source, 'experiment.js');
        if (result.error) {
          const e = vm.dump(result.error);
          result.error.dispose();
          throw Error(e.message ?? String(e));
        }
        result.value.dispose();
        send('result', { output });
      } finally {
        vm.dispose();
        runtime.dispose();
      }
    } else if (language === 'sql') {
      const SQL = await initSqlJs({ wasmBinary: files['sql.wasm'] });
      const db = new SQL.Database();
      try {
        send('ready');
        const iterator = db.iterateStatements(source),
          tables: any[] = [];
        let rows = 0;
        for (const statement of iterator) {
          const columns = statement.getColumnNames();
          const values: any[] = [];
          while (statement.step()) {
            if (++rows > 1000) throw Error('表格输出超过 1000 行');
            values.push(statement.get());
          }
          if (columns.length) tables.push({ columns, values });
        }
        const serialized = JSON.stringify(tables, null, 2);
        if (serialized.length > 65536) throw Error('输出超过 64 KiB');
        send('result', { output: serialized });
      } finally {
        db.close();
      }
    } else {
      const asm = new TextDecoder().decode(files['pyodide.asm.js']);
      (0, eval)(asm + '\nglobalThis._createPyodideModule = _createPyodideModule;');
      const py = await loadPyodide({
        indexURL: 'https://runtime.invalid/',
        lockFileContents: new TextDecoder().decode(files['pyodide-lock.json']),
        stdLibURL: 'https://runtime.invalid/python_stdlib.zip',
        packageBaseUrl: 'https://runtime.invalid/',
        packages: Object.keys(files).some((k) => k.startsWith('numpy-')) ? ['numpy'] : [],
        jsglobals: Object.freeze({}),
        stdin: () => input,
        stdout: print,
        stderr: print,
      });
      send('ready');
      const result = await py.runPythonAsync(source);
      if (result !== undefined && result !== null) print(result);
      if (result && typeof result.destroy === 'function') result.destroy();
      send('result', { output });
    }
  } catch (e) {
    send('error', { message: e instanceof Error ? e.message : '计算失败', output });
  }
};
