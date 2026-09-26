# M4 计算机与AI规格

S16–S19，A21–A25/A28。用户代码只经显式启动，在opaque-origin iframe内Worker运行；不能访问课程Cookie、真实数据库、宿主shell或任意网络。JS/SQL限时2秒，Python5秒，输出最多64KiB。

Given固定训练/验证划分，When训练小模型，Then验证集不参与参数更新。GivenAttention掩码，Then被屏蔽项权重0、剩余归一化。GivenCNN固定输入，Then结果符合手算互相关。训练或代码运行成功不改变掌握状态。
