# 公平奖励分配的五大公理：去中心化金融的可证明公平框架（中文翻译）

**Faraday1 (Will Glynn) & JARVIS**

*VibeSwap协议 -- vibeswap.org*

*2026年3月*

---

## 摘要

我们提出五条公理，共同定义去中心化合作系统中*可证明公平*的奖励分配。前四条公理——效率性、对称性、零玩家性和成对比例性——源自经典合作博弈论及Shapley值。第五条公理**时间中立性**是一项新颖公理，用于消除费用分配中的时间偏差：在不同时期作出相同贡献的参与者必须获得相同的奖励。我们证明，加权比例Shapley分配可同时满足所有五条公理，为每条公理提供链上验证方法，并在Solidity中展示可运行的实现。该框架解决了代币经济学中的一个根本性张力：如何奖励奠基性的（"洞穴层级"的）贡献，同时又不引入现有协议中普遍存在的基于时间的租金提取。我们表明，Shapley值通过边际贡献分析*自然地*将更高奖励分配给影响力更大的工作，从而使早鸟奖励在数学上变得没有必要。

**关键词**：Shapley值，合作博弈论，公平公理，DeFi，代币经济学，时间中立性，MEV

---

## 1. 动机

### 1.1 时间租金问题

去中心化代币分配的主流范式奖励的是参与者*何时*到来，而非*贡献了什么*。预售折扣让早期买家获得更便宜的代币，而不考量其对协议的价值。减半排放计划确保第二年的相同流动性提供所获收益仅为第一年的一半。忠诚度乘数奖励被动持有而非主动贡献。以创世纪时间戳为锚点的归属计划按时间戳而非边际影响分配奖励。

这些机制造成了结构性不平等：**时间成为一种不劳而获的租金。** 在时期$e_1$提供流动性的参与者比在时期$e_2$提供相同流动性的参与者赚得更多，不是因为其贡献更有价值，而是因为$e_1 < e_2$。这是最纯粹形式的租金提取——通过位置优势而非生产性贡献获取价值。

| 机制 | 时间偏差 | 失败模式 |
|-----------|-----------|--------------|
| 预售折扣 | 越早 = 代币越便宜 | 投机者从建设者处提取价值 |
| 创世归属 | 第零天固定分配 | 按时间戳而非贡献奖励 |
| 费用排放减半 | 早期时期支付更多 | 第二年相同工作收益减半 |
| 忠诚度乘数 | 持有时间越长 = 乘数越高 | 被动持有优于主动贡献 |

共同主线：这些机制均不衡量*参与者对合作盈余实际贡献了什么*。它们衡量的是*参与者何时出现*。

### 1.2 洞穴悖论

> *"Tony Stark在洞穴里用一堆废料就能造出来！"*

从零开始构建协议的第一版在客观上比迭代现有系统更为困难。第一行代码具有无限的边际价值——没有它，什么都不存在。这种困难*应当*体现在更高的奖励中。但捕获这种困难的机制至关重要。

如果较高的奖励来自时间戳乘数（例如，"第零纪元支付2倍"），那它就是时间租金。如果有人在第三年构建了同等基础性的组件——比如一个能够实现全新功能类别的新型共识机制——时间戳乘数会给予他们等效边际影响一半的奖励。

如果较高的奖励来自*衡量工作对合作盈余的边际贡献*，无论何时发生，困难都能被正确捕获。这就是洞穴悖论的解决方案：**奠基性工作在数学必然性下获得更多回报，而非凭借时间特权。**

### 1.3 设计目标

我们寻求满足以下条件的奖励分配机制：

1. **完整性**：所有产生的价值均分配给贡献者。不泄漏，不凭空创造。
2. **贡献比例性**：任意两名参与者之间的奖励比率等于其贡献比率。
3. **时间独立性**：从贡献到奖励的映射不依赖于日历时间或时期编号。
4. **链上可验证性**：每项公平属性均可在常数时间内由任意观察者检验。
5. **洞穴兼容性**：奠基性工作自然获得更多回报，无需时间特权。

---

## 2. 形式化定义

### 2.1 贡献

**定义1（贡献）。** 贡献$c$是一个元组$(contributor, magnitude, scarcity, stability, quality)$，其中：

- $contributor \in \mathbb{A}$（有效地址集合）
- $magnitude \in \mathbb{N}$（提供的原始价值，例如以wei计量的流动性）
- $scarcity \in [0, 10000]$（提供市场稀缺侧）
- $stability \in [0, 10000]$（在高波动期间的持续存在）
- $quality \in [0, 10000]$（行为信誉分数）

**关键设计选择**：时间戳被*明确排除*在贡献定义之外。贡献完全由做了什么以及做得多好来表征，而绝非由何时做。

### 2.2 合作博弈

**定义2（合作博弈）。** 合作博弈是三元组$G = (N, v, V)$，其中：

- $N = \{1, 2, \ldots, n\}$是参与者集合
- $v: 2^N \to \mathbb{R}$是将联盟映射到其价值的特征函数
- $V = v(N) \in \mathbb{R}_{\geq 0}$是总可分配价值（大联盟的价值）

在DeFi场景下，每个经济事件——批量结算、费用分配纪元、流动性挖矿轮次——构成一个独立的合作博弈。参与者是为该事件作出贡献的人。总价值$V$是该事件交易活动产生的费用。

### 2.3 加权贡献

**定义3（加权贡献）。** 对于博弈$G$中具有贡献$c_i$的参与者$i$，加权贡献为：

$$w_i = \left(\frac{D_i \cdot 0.4 + T_i \cdot 0.3 + S_i \cdot 0.2 + St_i \cdot 0.1}{1.0}\right) \cdot Q_i$$

其中：

- $D_i$ = 直接贡献分数（权重40%）——提供的原始价值
- $T_i$ = 赋能贡献分数（权重30%）——在池中的时间，促进他人
- $S_i$ = 稀缺性分数（权重20%）——提供市场稀缺侧
- $St_i$ = 稳定性分数（权重10%）——在波动期间保持存在
- $Q_i \in [0.5, 1.5]$ = 源自行为信誉的质量乘数

权重向量$(0.4, 0.3, 0.2, 0.1)$反映了协议的价值层级：直接提供最重要，但赋能他人、提供稀缺流动性以及在逆境中维持稳定均对合作盈余有所贡献。

### 2.4 Shapley分配

**定义4（Shapley分配）。** 参与者$i$在博弈$G$中的Shapley分配为：

$$\phi_i(G) = V \cdot \frac{w_i}{\sum_{j \in N} w_j}$$

这是加权比例分配。它按每位参与者加权贡献的精确比例分配总价值$V$。记总权重$W = \sum_{j \in N} w_j$。

**注记。** 经典Shapley值涉及对所有联盟进行指数级计算。我们的加权比例形式是一种计算上可行的近似，它在保留基本公平属性（效率性、对称性、零玩家性）的同时，还能支持更强的成对比例性和时间中立性公理。权衡——失去完整的联盟边际贡献分析——在每事件博弈模型中是可接受的，因为贡献可以独立测量。

---

## 3. 五大公理

我们现在依次陈述每条公理，证明其在定义4的Shapley分配下成立，并描述如何在链上验证。

### 3.1 公理1：效率性

**陈述。** 所有产生的价值均被分配。系统中无价值泄漏，也无价值凭空创造。

$$\sum_{i \in N} \phi_i(G) = V$$

**证明。**

$$\sum_{i \in N} \phi_i(G) = \sum_{i \in N} V \cdot \frac{w_i}{W} = V \cdot \frac{1}{W} \sum_{i \in N} w_i = V \cdot \frac{W}{W} = V \quad \blacksquare$$

**链上验证。** 给定分配数组$[\phi_1, \phi_2, \ldots, \phi_n]$和总价值$V$：

```solidity
function verifyEfficiency(
    uint256[] memory allocations,
    uint256 totalValue,
    uint256 tolerance  // 整数舍入的容差：通常为 n
) external pure returns (bool fair, uint256 deviation);
```

计算$\left|\sum_i \phi_i - V\right| \leq \epsilon$，其中$\epsilon$随参与者数量线性缩放（每次除法每位参与者最多1 wei的舍入误差）。复杂度：$O(n)$。

**意义。** 效率性是合作博弈的守恒定律。以热力学术语而言，价值在分配过程中既不被创造也不被消灭——只是被转移。这防止了价值泄漏（协议虹吸）和价值膨胀（奖励超过所赚取的量）。

---

### 3.2 公理2：对称性

**陈述。** 如果两位参与者作出相等的加权贡献，则他们获得相等的奖励。

$$w_i = w_j \implies \phi_i(G) = \phi_j(G)$$

**证明。**

$$w_i = w_j \implies \frac{w_i}{W} = \frac{w_j}{W} \implies V \cdot \frac{w_i}{W} = V \cdot \frac{w_j}{W} \implies \phi_i(G) = \phi_j(G) \quad \blacksquare$$

**链上验证。** 对称性是成对比例性（公理4）的特例。当$w_i = w_j$时，成对检验简化为$|\phi_i - \phi_j| \leq \epsilon$。不需要额外的验证基础设施。

**意义。** 对称性消除了*基于身份*的特权。两个贡献等值的地址获得相同奖励，无论其历史、在当前博弈外的声誉，或与协议创始者的关系。结合贡献定义中对时间戳的排除，对称性确保*你做了什么*是唯一重要的。

---

### 3.3 公理3：零玩家性

**陈述。** 加权贡献为零的参与者获得零奖励。

$$w_i = 0 \implies \phi_i(G) = 0$$

**证明。**

$$w_i = 0 \implies \phi_i(G) = V \cdot \frac{0}{W} = 0 \quad \blacksquare$$

**链上验证。**

```solidity
function verifyNullPlayer(
    uint256 reward,
    uint256 weight
) external pure returns (bool isNullPlayerFair) {
    if (weight == 0) return reward == 0;
    return true;  // 非零权重：任何奖励均可接受
}
```

复杂度：$O(1)$。

**意义。** 零玩家公理防止搭便车。对合作盈余毫无贡献的参与者——既不提供流动性、也不促进他人、也不承担风险——将一无所获。这是效率性的补充：如果所有价值必须被分配（公理1），其中没有任何价值可以流向非贡献者（公理3）。两者共同形成一个封闭系统，价值从产生到按贡献比例分配之间的流动具有排他性。

**关于Lawson公平底线的注记。** VibeSwap的实现为*确实*作出贡献的任何参与者包含了最低1%份额（Lawson底线），确保舍入、燃气成本或极端权重差异不会将诚实贡献者的奖励降至零。该底线仅在$w_i > 0$时适用，从而保留零玩家公理：零贡献仍然产生零奖励。该底线是对有限精度算术和人类现实的实际让步——出现并诚实行事本身具有价值。

---

### 3.4 公理4：成对比例性

**陈述。** 对于任意两位参与者$i, j$，其中$w_j > 0$，其奖励比率等于其贡献比率。

$$\frac{\phi_i(G)}{\phi_j(G)} = \frac{w_i}{w_j}$$

**证明。**

$$\frac{\phi_i(G)}{\phi_j(G)} = \frac{V \cdot w_i / W}{V \cdot w_j / W} = \frac{w_i}{w_j} \quad \blacksquare$$

总价值$V$和归一化因子$W$在比率中相消，仅留下相对贡献。

**链上验证。** 整数算术中除法存在问题（截断、除以零）。交叉乘法消除了两个问题：

$$|\phi_i \cdot w_j - \phi_j \cdot w_i| \leq \epsilon$$

```solidity
function verifyPairwiseProportionality(
    uint256 rewardA,
    uint256 rewardB,
    uint256 weightA,
    uint256 weightB,
    uint256 tolerance
) external pure returns (bool fair, uint256 deviation) {
    uint256 lhs = rewardA * weightB;
    uint256 rhs = rewardB * weightA;
    deviation = lhs > rhs ? lhs - rhs : rhs - lhs;
    fair = deviation <= tolerance;
}
```

每对复杂度：$O(1)$。完整博弈验证（所有对）为$O(n^2)$，适用于链上争议解决或链下审计。

**推论4.1。** 成对比例性与$V$无关地得以保持。即使一个博弈产生比另一个更高的总费用，任意两位参与者之间的奖励*比率*也仅取决于其相对贡献。这是一个强有力的不变量：它意味着参与者之间的公平性独立于市场条件。

**意义。** 成对比例性是五条公理中最强的。它蕴含对称性（当$w_i = w_j$时，比率为1:1）。它蕴含零玩家性（当$w_i = 0$时，比率要求$\phi_i = 0$）。它提供了*局部*验证机制——任意两位参与者可以在不了解联盟其余部分的情况下检验其相对公平性。这正是去中心化系统中无需信任、无需许可的验证所需要的属性。

**与经典Shapley的关系。** 经典Shapley的可加性公理指出对于可加博弈$\phi_i(v + w) = \phi_i(v) + \phi_i(w)$。在我们的每事件模型中，各博弈独立，因此可加性在轨道内平凡成立。成对比例性是一个更强的局部条件，取代了可加性作为"结构性"公理的角色，在对抗性环境中提供了更具操作价值的保证。

---

### 3.5 公理5：时间中立性

**陈述。** 对于时刻$t_1$处的贡献$c_i$（在博弈$G_1$中）和时刻$t_2$处的贡献$c_j$（在博弈$G_2$中）：

$$c_i \equiv c_j \text{（相同贡献参数）}$$

$$N(G_1) \cong N(G_2) \text{ 且 } V(G_1) = V(G_2)$$

$$\implies \phi_i(G_1) = \phi_j(G_2)$$

如果两个博弈具有同构联盟和相等总价值，则相同贡献获得相同分配，**无论博弈何时发生。**

**证明。**

分配公式为：

$$\phi_i(G) = V \cdot \frac{w_i}{W}$$

输入为：

1. $V$ ——总可分配价值，由该事件的交易活动决定
2. $w_i$ ——加权贡献，由$(magnitude, scarcity, stability, quality)$计算
3. $W = \sum_{j \in N} w_j$ ——所有加权贡献之和

这些输入均不引用`block.timestamp`、时期编号、纪元计数器或任何其他时间变量。如果$c_i \equiv c_j$（相同贡献参数），则$w_i = w_j$。如果$N(G_1) \cong N(G_2)$（具有相同贡献参数的同构联盟），则$W(G_1) = W(G_2)$。如果$V(G_1) = V(G_2)$，则所有输入相等，因此：

$$\phi_i(G_1) = V(G_1) \cdot \frac{w_i}{W(G_1)} = V(G_2) \cdot \frac{w_j}{W(G_2)} = \phi_j(G_2) \quad \blacksquare$$

**推论5.1。** 减半（将$V$乘以$1/2^{era}$）通过使$V$成为纪元的函数（而纪元是时间的函数）来违反时间中立性。在减半机制下：

$$\phi_i(G_1) = V \cdot \frac{w_i}{W} \cdot 1.0 \quad \text{（第零纪元）}$$
$$\phi_i(G_2) = V \cdot \frac{w_i}{W} \cdot 0.5 \quad \text{（第一纪元）}$$

参与者$i$为相同工作获得一半奖励。从费用分配中去除减半机制可恢复时间中立性。

**链上验证。** 对于具有相同联盟结构和总价值的两个博弈$G_1, G_2$：

```solidity
function verifyTimeNeutrality(
    uint256 reward1,
    uint256 reward2,
    uint256 tolerance
) external pure returns (bool neutral, uint256 deviation) {
    deviation = reward1 > reward2 ? reward1 - reward2 : reward2 - reward1;
    neutral = deviation <= tolerance;
}
```

每对参与者跨博弈复杂度：$O(1)$。

**意义。** 时间中立性是新颖公理——是使本框架区别于经典合作博弈论的公理。在传统场景中，博弈孤立地分析，跨博弈时间公平性的问题并不出现。在区块链协议中，*同一机制*在数年乃至数十年间反复运行，时间公平性成为首要问题。

时间中立性*不*要求所有博弈支付相同的绝对奖励。如果市场活动增长，$V$增长，所有参与者赚得更多——因为市场创造了更多价值，而非由于时机。时间中立性所禁止的是通过减半计划、纪元乘数或任何使贡献-奖励映射成为日历时间函数的机制对$V$进行*人为的*时间性修改。

---

## 4. 洞穴定理

我们现在证明Shapley值自然地对奠基性工作给予更高奖励，从而无需时间特权即可解决洞穴悖论。

### 4.1 边际贡献分析

**定理（洞穴定理）。** 在完整Shapley值下，移除后对合作盈余造成最大损失的参与者获得最高分配。

**证明。** 博弈$(N, v)$中玩家$i$的经典Shapley值为：

$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N|-|S|-1)!}{|N|!} \left[v(S \cup \{i\}) - v(S)\right]$$

这是对所有不包含$i$的联盟$S$的边际贡献$v(S \cup \{i\}) - v(S)$的加权平均。

考虑奠基性贡献者$F$（例如协议架构师）。对于大多数联盟$S$：

$$v(S \cup \{F\}) - v(S) \approx v(S \cup \{F\})$$

因为当$S$缺乏奠基性基础设施时$v(S) \approx 0$。没有协议，就没有交易，没有费用，没有合作盈余。$F$对任何联盟的边际贡献约为该联盟能够产生的*全部价值*。

相反，对于增量贡献者$I$（例如向已具高流动性的池添加边际流动性的参与者）：

$$v(S \cup \{I\}) - v(S) \approx \delta$$

对于较小的$\delta$，因为联盟$S$在没有$I$的情况下已能运作。

对所有联盟的加权平均产生$\phi_F \gg \phi_I$。$\blacksquare$

### 4.2 含义

**推论（洞穴兼容性）。** 在没有其他贡献者是必要的极限情况下，构建核心协议的创始者的Shapley值趋近于$V$。这是可能的最大分配——不是因为他们是第一个，而是因为他们的贡献对每个联盟都是奠基性的。

**推论（奠基性工作的时间等价性）。** 如果两位贡献者在不同时间构建了同等奠基性的组件——一位在创世时，一位在第五年——在具有相等$V$和同构联盟的博弈中，他们获得相等的Shapley值。工作的困难程度通过其对合作盈余的边际影响来捕获，而非通过时间戳。

这解决了洞穴悖论：在洞穴中构建*确实*更难，Shapley值通过更高的边际贡献反映了这一点。但更高的奖励由*贡献的数学*而非*时机的偶然*所证明。P-000——公平高于一切——得以满足：该机制是公平的，因为它衡量了真正重要的事情。

---

## 5. 双轨分配

### 5.1 Bitcoin先例

Bitcoin的设计包含一个具有启发性的分离：

- **区块奖励**（新BTC创建）遵循减半计划。早期矿工每个区块获得更多BTC。这是一种明确的自举激励。
- **交易费用**无论纪元如何，均全额分配给找到区块的矿工。费用不适用减半。

经济逻辑是合理的：区块奖励是*激励分配*（在网络具有显著交易量之前说服矿工参与）。交易费用是*赚取的价值*（提供服务的报酬）。不同经济类别需要不同的公平属性。

### 5.2 费用分配：全部五条公理

**轨道1——费用分配（时间中立）**

来源：每批次结算产生的交易费用。

规则：纯比例Shapley分配。不减半。不调整纪元。100%费用根据加权贡献分配给事件的贡献者联盟。

属性：

| 公理 | 状态 | 验证 |
|-------|--------|--------------|
| 1. 效率性 | 满足 | $\sum \phi_i = V$ |
| 2. 对称性 | 满足 | $w_i = w_j \implies \phi_i = \phi_j$ |
| 3. 零玩家性 | 满足 | $w_i = 0 \implies \phi_i = 0$ |
| 4. 成对比例性 | 满足 | $\|\phi_i w_j - \phi_j w_i\| \leq \epsilon$ |
| 5. 时间中立性 | 满足 | 分配中无时间变量 |

理由：费用是*现在*由*此*联盟创造的价值。根据纪元减少它们是在惩罚当前贡献者的历史博弈计数。费用就是费用——其分配应取决于谁帮助赚取了它，而非何时赚取。

### 5.3 协议排放：透明计划

**轨道2——代币排放（按计划）**

来源：协议代币排放（如果且当其存在时）。

规则：减半计划适用。早期纪元排放更多代币。这是一种明确的、自愿的社会契约——而非隐性的偏袒。

属性：

| 公理 | 状态 | 注记 |
|-------|--------|------|
| 1. 效率性 | 满足 | 所有排放代币均被分配 |
| 3. 零玩家性 | 满足 | 零贡献 = 零代币 |
| 4. 成对比例性 | 纪元内满足 | 每博弈比率得以保持 |
| 5. 时间中立性 | 故意违反 | 自举激励，类似Bitcoin |

理由：代币排放是一种自举激励。与Bitcoin的区块奖励一样，它们的存在是为了创造初始采用压力。它们不是"赚取的价值"——而是"激励分配"。减半是透明的、可预测的，并提前披露。没有人对时间结构被蒙骗。

### 5.4 关键区分

$$\text{费用} = \text{赚取的价值} \quad \longrightarrow \quad \text{必须时间中立}$$

$$\text{排放} = \text{激励分配} \quad \longrightarrow \quad \text{可以按时间计划}$$

此分离在合约层面通过`GameType`枚举实现：

```solidity
enum GameType {
    FEE_DISTRIBUTION,   // 时间中立：不减半，纯Shapley
    TOKEN_EMISSION      // 按计划：减半适用（类似Bitcoin区块奖励）
}
```

每个合作博弈在创建时被标记其类型。费用分配博弈**永远**不适用减半。代币排放博弈遵循配置的减半计划。类型一旦设置即不可变，任意观察者均可公开查询。

---

## 6. 链上验证

### 6.1 验证原则

无法独立验证的公平声明不是公平保证——而是承诺。在对抗性环境中，承诺毫无价值。本框架中的每条公理都有相应的链上验证方法，任何观察者均可在任何时间、无需许可地调用。

### 6.2 验证方法

**成对比例性检验（核心原语）：**

对于任何已结算博弈中的任意两位参与者$(i, j)$：

$$|\phi_i \cdot w_j - \phi_j \cdot w_i| \leq \epsilon$$

交叉乘法表述完全避免了除法，消除了除以零的风险和截断误差放大。容差$\epsilon$随总权重缩放（每次整数除法每位参与者最多1 wei的舍入误差）。

```solidity
// 任何人均可调用。无需许可。
function verifyPairwiseFairness(
    bytes32 gameId,
    address participant1,
    address participant2
) external view returns (bool fair, uint256 deviation);
```

**效率性检验：**

$$\left|\sum_{i \in N} \phi_i - V\right| \leq n$$

其中$n = |N|$是参与者数量。

**时间中立性检验：**

对于两个具有`GameType.FEE_DISTRIBUTION`、相同联盟结构和相等总价值的博弈$G_1, G_2$：

$$|\phi_i(G_1) - \phi_i(G_2)| \leq \epsilon$$

```solidity
function verifyTimeNeutrality(
    bytes32 gameId1,
    bytes32 gameId2,
    address participant
) external view returns (bool neutral, uint256 deviation);
```

### 6.3 争议解决

如果任何验证检验失败，则构成**不公平的密码学证明**——一个链上工件，证明实现违反了其所声明的公理。在正确实现下，这些检验永远不应失败（在容差范围内的整数舍入除外）。它们的目的不是捕捉频繁的违规，而是提供对公平性的*可信承诺*：协议使其公平属性可证伪，任何人均可随时尝试证伪。

---

## 7. 实现

### 7.1 ShapleyDistributor.sol

`ShapleyDistributor`合约将五条公理实现为基于OpenZeppelin v5.0.1构建的UUPS可升级合约。关键设计元素：

**加权贡献计算：**

```solidity
uint256 public constant DIRECT_WEIGHT   = 4000;   // 40%
uint256 public constant ENABLING_WEIGHT  = 3000;   // 30%
uint256 public constant SCARCITY_WEIGHT  = 2000;   // 20%
uint256 public constant STABILITY_WEIGHT = 1000;   // 10%
```

每位参与者的加权贡献由四个正交维度计算，结合源自行为信誉的质量乘数$Q_i \in [0.5, 1.5]$。参与的时间戳不是输入。

**双轨分配：**

```solidity
enum GameType {
    FEE_DISTRIBUTION,   // 时间中立：不减半
    TOKEN_EMISSION      // 减半计划适用
}
```

减半乘数仅适用于`TOKEN_EMISSION`博弈。`FEE_DISTRIBUTION`博弈在不进行时间性修改的情况下分配全部价值$V$，满足时间中立性。

**用于验证的状态存储：**

```solidity
mapping(bytes32 => mapping(address => uint256)) public shapleyValues;
mapping(bytes32 => mapping(address => uint256)) public weightedContributions;
mapping(bytes32 => uint256) public totalWeightedContrib;
```

成对验证所需的三个值——奖励、权重和总权重——均存储在链上且公开可读。这使任意观察者均可进行无需许可的验证。

### 7.2 PairwiseFairness.sol

`PairwiseFairness`库将验证原语作为纯函数提供，可通过`staticcall`在无燃气成本的情况下调用：

```solidity
library PairwiseFairness {
    struct FairnessResult {
        bool fair;
        uint256 deviation;
        uint256 toleranceUsed;
    }

    function verifyPairwiseProportionality(
        uint256 rewardA, uint256 rewardB,
        uint256 weightA, uint256 weightB,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyTimeNeutrality(
        uint256 reward1, uint256 reward2,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyEfficiency(
        uint256[] memory allocations,
        uint256 totalValue,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory);

    function verifyNullPlayer(
        uint256 reward, uint256 weight
    ) internal pure returns (bool);

    function verifyAllPairs(
        uint256[] memory rewards,
        uint256[] memory weights,
        uint256 tolerance
    ) internal pure returns (
        bool allFair, uint256 worstDeviation,
        uint256 worstPairA, uint256 worstPairB
    );
}
```

`verifyAllPairs`函数执行穷举的$O(n^2)$成对验证，适用于链上争议解决或链下审计。对于常规验证，$O(1)$的单对检验已足够。

### 7.3 Lawson公平底线

一个实际考量：在具有极端权重差异的有限精度整数算术中，即使贡献非零，贡献者的比例份额也可能舍入为零。Lawson公平底线保证对任何$w_i > 0$的参与者有最低1%份额（100个基点）：

```solidity
uint256 public constant LAWSON_FAIRNESS_FLOOR = 100; // 以BPS计的1%
```

该底线通过可选的`ISybilGuard`集成防止女巫攻击利用：未经验证身份的参与者获得比例Shapley奖励，但被排除在底线保证之外。没有此守卫，攻击者可以分裂成$k$个账户，每个账户声索1%最低份额，从池中提取最多$k$%。

---

## 8. 与先前工作的关系

### 8.1 经典Shapley值（1953年）

Shapley的原始公理化使用了四条公理：效率性、对称性、零玩家性和可加性。我们的框架保留前三条，并用两条新公理——成对比例性和时间中立性——替代可加性，这两条新公理更适合DeFi协议的重复博弈、链上可验证场景。

此替代是有充分理由的：在经典场景中，可加性确保博弈之和的价值等于各价值之和。在我们的每事件模型中，博弈按构造独立，可加性在每个轨道内平凡成立。成对比例性提供了一个更强的、可局部验证的保证，在对抗性环境中具有更大的操作价值。

### 8.2 加权投票博弈

加权比例分配$\phi_i = V \cdot w_i / W$是特征函数为$v(S) = \sum_{i \in S} w_i$的加权投票博弈Shapley值的一个经过充分研究的特例。我们的贡献不在于分配公式本身，而在于：(a) 从权重计算中排除时间变量，(b) 链上验证方法，以及 (c) 将时间中立性正式化为重复博弈场景下的第五条公理。

### 8.3 现有DeFi奖励系统

大多数DeFi协议使用三种奖励机制之一：比例份额（Uniswap v2流动性提供者费用）、时间加权平均余额（Compound COMP分配）或固定归属计划（团队/投资者分配）。这些均不满足全部五条公理。比例份额满足效率性和成对比例性，但通常通过排放减半违反时间中立性。时间加权平均余额从构造上引入时间依赖性。固定归属与贡献毫无关联。

---

## 9. 结论

五条公理——效率性、对称性、零玩家性、成对比例性和时间中立性——形成了去中心化奖励分配的完整且可验证的公平框架。前三条继承自合作博弈论。成对比例性将经典可加性公理强化为一个适合对抗性、无需许可环境的可局部验证不变量。时间中立性是新颖的：它正式化了赚取价值的分配不得依赖于日历时间的要求，消除了现有代币经济学中普遍存在的时间租金提取。

洞穴定理表明，这些公理不会使奠基性贡献者处于不利地位。Shapley值自然地将更高奖励分配给对合作盈余具有更大边际影响的工作。在洞穴中构建赚得更多——不是作为时机特权，而是作为工作在每个联盟中的中心性的数学必然结果。

双轨分离（时间中立费用与按计划排放）解决了自举激励与长期公平之间的表面张力，遵循Bitcoin区块奖励与交易费用之间区分所树立的先例。

每条公理都有相应的链上验证方法。公平不是被承诺的——而是可证明的。任何观察者均可在任何时间检验协议的奖励分配是否满足其所声明的属性。这是去中心化系统应当追求的标准：不是"相信我们，我们是公平的"，而是"现在就在链上自行验证"。

P-000：公平高于一切。不是作为口号，而是作为定理。

---

## 参考文献

1. Shapley, L.S. (1953). "n人博弈的一个值。" *博弈论贡献*，第二卷，数学研究年报28，第307--317页。

2. Nakamoto, S. (2008). "Bitcoin：一种点对点电子现金系统。" bitcoin.org/bitcoin.pdf

3. Glynn, W. (2026). "时间中立代币经济学：通过Shapley值实现可证明公平的分配。" VibeSwap协议文档。

4. Roth, A.E. (1988). "Shapley值：纪念Lloyd S. Shapley的论文集。" 剑桥大学出版社。

5. Winter, E. (2002). "Shapley值。" *经济应用博弈论手册*，第三卷，第53章。

6. Adams, H., Zinsmeister, N., Robinson, D. (2020). "Uniswap v2核心。" Uniswap协议。

---

*本文正式化了VibeSwap的ShapleyDistributor合约中实现的公平框架。此处描述的公理、证明和验证方法并非愿景——它们已部署、经过测试且可在链上验证。源代码开放：`contracts/incentives/ShapleyDistributor.sol`和`contracts/libraries/PairwiseFairness.sol`。*

*建于洞穴之中。以数学为证。*
