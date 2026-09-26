# M2 数学物理工程规格

S01–S11、S20，关联A19/A21/A22/A23/A26/A28。每个模板使用固定id/version、有限参数、模型假设和可复核参考结果。示意、简化和真实计算必须如实区分。

Given默认和边界参数，When执行数值核，Then结果有限或明确拒绝。Given固定seed和模板版本，When重做，Then可复现。Given晚到Worker结果，WhenrunRevision已变化，Then丢弃旧输出。几何图形必须保持坐标比例。

完整主题覆盖、讲练路径及人工复核仍按PRD，不以已有模板数量替代。
