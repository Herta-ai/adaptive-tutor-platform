# M4 实现

QuickJS-WASM、Pyodide和sql.js从固定文件清单加载并校验hash；父页面经MessageChannel提供只读运行库数据，iframe CSP禁止网络。TensorFlow.js CPU在独立Worker进行固定小型MLP训练，30秒预算及显式停止。
