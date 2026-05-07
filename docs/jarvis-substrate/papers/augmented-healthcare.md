# Augmented Healthcare Allocation

Healthcare is the largest substrate this paper series has touched, by every metric that matters: dollars per year, lives affected, severity of failure when the mechanism breaks, and political weight of the institutions involved. It's also the substrate where the failure modes of the existing pure mechanisms are most visible to people who don't otherwise think about mechanism design. Almost everyone has a healthcare horror story. Most of them are structural, not personal.

The U.S. system optimizes for billing extraction. Defensive medicine, surprise billing, coding upcharges, prior-authorization friction, and a layer of intermediaries (PBMs, billing agencies, network administrators) skim from each transaction without delivering care. Patients pay multiples of what the underlying care costs. Providers spend more time on billing infrastructure than on patients.

Single-payer variants gatekeep through different mechanisms. Treatment denials, queue prioritization, formulary restrictions, and slow approval cycles ration access. The rationing is often defensible — finite resources require allocation — but the rationing mechanisms tend toward discretionary opacity rather than structural transparency. Patients in single-payer systems don't pay extraction fees but do pay in waiting time, treatment limitations, and inability to escalate genuinely urgent cases.

These are not the only two architectures. Mixed systems (Germany, Switzerland, Singapore) combine private insurance with regulatory floors and centralized negotiation. They generally work better than pure U.S. or pure single-payer at most metrics, but they remain instances of the same dichotomy patched together — extraction in some layers, gatekeeping in others, and patients caught in the seams.

The pure mechanisms — actuarial pricing for insurance, fee-for-service or capitation for provider payment, formulary committees for drug coverage — are mathematically reasonable. The deployment is socially vulnerable to a constellation of failure modes that compound across the system. The conventional response is reform within the existing architecture (single-payer advocacy, ACA-style mixed-system patching, narrow direct-pay startups). Each helps somewhere and creates new failure modes elsewhere.

The right response is augmentation: preserve competitive provider markets and competitive insurance pricing where competition produces good outcomes, mutualize the catastrophic-risk layer fully and structurally, and add specific protective extensions that close the extraction and gatekeeping failure modes without disabling care delivery.

---

## The pure mechanism

Insurance markets pool risk across populations. An insurer collects premiums from members, pays claims when members need care, and earns the difference. Provider markets compete on care delivery — hospitals, physician groups, and specialty providers all sell care to insurers and patients. Drug markets are mediated by pharmaceutical manufacturers, regulators (FDA, EMA), and pricing intermediaries (PBMs in the U.S., national negotiating bodies elsewhere).

The interactions between these markets are dense. An insurer negotiates rates with provider networks. Providers bill insurers (and patients for the residual). Manufacturers negotiate drug prices with PBMs and national bodies. Patients are theoretically the customers but rarely direct buyers; they pay through premiums, through co-pays, through deductibles, and through tax-funded public coverage in mixed systems.

The pure mechanism's promise is that competition among insurers produces fair premium pricing, competition among providers produces high-quality care at competitive prices, and competition among manufacturers produces innovative drugs at affordable cost. In practice, none of these competitive markets work as advertised, for reasons specific to healthcare's information and risk structure.

---

## Failure modes

**Defensive medicine.** Providers order tests and procedures that are not medically necessary, in part because doing so reduces malpractice exposure. The cost is borne by patients and insurers; the legal protection is reaped by providers. Estimates of defensive-medicine cost run 5-10% of U.S. healthcare spending — hundreds of billions of dollars annually.

**Surprise billing.** A patient receives care at an in-network facility but is incidentally treated by an out-of-network provider (anesthesiologist, radiologist, emergency physician). The out-of-network provider bills directly at unilateral rates. The patient receives a bill that the insurer doesn't cover. Federal legislation (No Surprises Act) addresses some cases, but the underlying pattern — patients exposed to bills they could not have anticipated or consented to — recurs in adjacent forms.

**Coding upcharges and DRG gaming.** Providers code procedures to maximize reimbursement under the existing payment schedule. The coding is technically legal but systematically biases payments upward. Insurers respond with prior-authorization requirements that increase administrative overhead without preventing the gaming. The result: more administrative friction, no reduction in upward billing pressure.

**PBM extraction.** Pharmacy benefit managers sit between insurers and pharmacies, negotiating drug prices and rebate structures. The negotiation generates rebates that flow to PBMs (and occasionally to insurers), but rarely to patients. The list price of drugs continues to rise; the net price after rebates rises more slowly; the patient at the pharmacy counter pays the list price. PBMs extract margin from a position that exists only because the system is opaque enough to require them.

**Information asymmetry.** Patients can rarely evaluate care quality before receiving it. Providers know more than patients about which treatments are necessary and which are profitable. The asymmetry is not malicious in most cases but does mean that the patient's role as "consumer" cannot exercise the function consumers exercise in other markets. Competition on quality requires comparable quality information; healthcare quality information is often unavailable, lagged, or aggregated to the level of "this hospital has these patient outcomes" without the granularity needed to choose among providers.

**Adverse selection.** When patients can choose insurance plans and insurers can underwrite, sicker patients select more comprehensive plans and insurers reject sicker patients. The market sorts by risk in ways that defeat the purpose of insurance. ACA-style guaranteed-issue rules address this by mandate but produce other distortions (the individual mandate, premium spirals, narrow networks).

**Treatment denial in single-payer.** Single-payer systems control costs by denying or rationing care that mixed systems would cover. The denials are often medically defensible at the population level but unjust at the individual level. Patients with rare conditions or unconventional treatment needs get discriminated against by formulary structures that work for the median patient but not for them.

**Wait time as price.** When dollar prices are suppressed, queues emerge as the rationing mechanism. Single-payer systems trade financial cost for time cost. Patients with flexibility and resources find ways to bypass queues (private insurance, medical tourism, paying out of pocket); patients without those resources wait. The "free" healthcare turns out to be price-discriminating against the patients with least leverage.

These failure modes compound. Defensive medicine increases cost; cost increases premiums; premiums select against healthier insurance-buyers; the risk pool worsens; insurers respond with tighter authorization; tighter authorization increases administrative overhead; administrative overhead increases cost. Each layer of the system optimizes against the other layers, and the patient is the residual.

---

## Layer mapping

**Mutualize the catastrophic-care risk layer fully.** This is partially done already in most developed countries — that is what insurance and public health systems are supposed to do — but the mutualization is incomplete because the dynamics above produce systematic gaps. A truly mutualized catastrophic layer would cover the events whose financial scale exceeds individual capacity to plan for: serious illnesses, accidents, end-of-life care, rare conditions. These are the cases where the mathematical argument for risk pooling is strongest.

**Compete on the care-quality value layer.** Hospitals and providers should differentiate on measurable patient outcomes — recovery rates, complication-free discharges, quality-adjusted life years gained, patient-reported outcomes. The competition layer is for the elective and predictable care where patient choice can function. The catastrophic layer doesn't need competition because the patient isn't in a position to shop when they're having a heart attack.

The current architecture has these reversed. Catastrophic care is partially mutualized but with extraction layered through the mutualization (PBMs, insurance overhead, billing intermediaries skim from the catastrophic pool). Elective care is partially competitive but with information asymmetry and pricing opacity preventing the competition from functioning (patients can't see prices ahead of time; can't compare providers on outcomes; can't easily switch).

The augmented architecture inverts this. Catastrophic care becomes a clean, transparent, mutualized layer with structural protection against extraction. Elective care becomes a transparent competitive market with structural information disclosure that makes patient choice meaningful.

---

## Augmentations

**Parametric outcome-based payments.** Providers paid for measurable patient outcomes (recovery rates, QALYs gained, complication-free discharges) rather than procedure counts. The payment structure is set by formula, not by negotiated rate. Procedures are still billed individually for record-keeping, but the payment is determined by outcome metrics that get measured prospectively. This directly addresses defensive medicine — extra procedures that don't improve outcomes don't get paid for.

**Shapley distribution between PCPs, specialists, insurers, and patients.** When a patient experiences a successful treatment trajectory, the credit and the cost both flow proportionally to the parties whose contribution actually mattered. The PCP who diagnosed early, the specialist who treated correctly, the insurer who facilitated rapid authorization, and (where relevant) the patient who adhered to treatment all get recognized. This breaks the current architecture where each party optimizes independently and friction between them produces the patient's residual cost.

**Structural anti-extraction gates on billing.** Surprise billing, bundled-charge gaming, and similar extraction patterns made structurally unprofitable through automated detection and refund. Providers who systematically bill above outcome-justified amounts get deranked in network-quality scores, which conditions future contracting. PBM rebate structures get cryptographically transparent — every rebate flows on a public ledger so patients and regulators can audit who's capturing what.

**Catastrophic mutualization with cryptographic claim verification.** The catastrophic-care layer becomes a true mutualized pool. Premiums (or tax contributions) flow into the pool; claims pay out based on parametric triggers (diagnosis codes, treatment necessity verified by independent clinicians, outcome measurements). The pool's reserves and payouts are publicly auditable. The current opacity that lets insurers under-pay claims and over-charge premiums gets replaced by structural transparency.

**Patient-portable medical records with cryptographic provenance.** Patients own their medical records. Records are cryptographically signed by the providers generating them and stored in patient-controlled wallets. Patients grant access to providers as needed. This breaks the current EHR vendor lock-in (Epic, Cerner) that produces switching costs and makes care fragmentation worse. It also enables structural patient consent for research uses of medical data, which is currently a regulatory mess.

**Open pricing transparency for elective care.** Providers offering elective care publish prices in advance. The competitive layer requires comparable price information; without it, competition cannot function. Recent U.S. price-transparency rules require this on paper; enforcement is uneven. Structural enforcement — making published prices the prices that get charged, with deviations triggering refunds — makes the requirement bind.

**Quality information as common infrastructure.** Patient outcome data, provider quality metrics, and adverse-event reporting flow into a common database that anyone can query. The data structure is set by protocol, not by individual provider preference. Patients and PCPs can make referral decisions based on actual outcome data, not reputation or convenience. The information asymmetry that defeats consumer choice gets replaced by accessible structural information.

---

## Implementation reality

This substrate has the most institutional weight of any in this paper series. The U.S. healthcare system represents almost 18% of GDP. Insurance companies, hospital chains, pharmaceutical manufacturers, and PBMs are some of the largest political donors in the country. Any augmentation that compresses their extraction margin will face active opposition.

The international landscape is more receptive in places. Single-payer systems looking to address their gatekeeping failures have demonstrated willingness to experiment with parametric payment models (the UK's NICE methodology is a partial precedent; Singapore's Medisave/Medishield combination is structurally interesting). The augmentation pattern can be deployed first in receptive jurisdictions and demonstrated to work before attempting U.S. deployment.

The staging path is bottom-up by care category. Specific high-cost, high-failure-mode categories — cancer treatment, end-of-life care, joint replacement, certain elective surgeries — have the worst current outcomes and the highest receptiveness to outcome-based reform. Pilot programs in these categories can demonstrate the augmentation pattern at small scale before generalization.

The largest constraint is the regulatory and legal framework. Healthcare is heavily regulated; new payment structures require regulatory approval; new data-sharing arrangements require HIPAA navigation. The augmentation pattern has to thread these constraints rather than assume them away. Some augmentations (cryptographic provenance for medical records) have natural alignment with existing regulations; others (parametric payments) require regulatory adaptation that is achievable but slow.

The largest opportunity is that the existing system is so visibly broken that almost every constituency wants reform — including the constituencies who currently profit from the brokenness, because they recognize the trajectory is unsustainable. The augmentation pattern offers a structural alternative to either extraction-heavy or gatekeeping-heavy reform, which is more politically tractable than either pole.

---

## What changes

If the augmentation pattern is implemented at scale, three things change at the system level.

First, the patient stops being the residual. In the current architecture, when insurers and providers and PBMs each optimize against each other, the friction shows up in the patient's bill, the patient's wait time, and the patient's outcome variance. In the augmented architecture, the friction gets compressed by structural rules, and the patient's experience becomes the system's measured output rather than its absorbed cost.

Second, the cost growth curve bends. U.S. healthcare spending has been growing faster than GDP for decades, with the excess driven primarily by the failure modes above (defensive medicine, billing extraction, administrative overhead, PBM rents). Augmentation compresses each of these. The growth doesn't stop — care genuinely is becoming more capable and capability costs money — but the extraction-driven component of growth gets removed.

Third, outcome measurement becomes possible at the population level. The current system can measure spending and procedures with precision but measures outcomes poorly. The augmented system measures outcomes natively because outcomes are the payment basis. Public health information that is currently unavailable becomes available, which enables better policy decisions across the rest of the substrate.

The downstream effect, if the substrate-port succeeds, is a healthcare system that delivers better outcomes for less money to more patients with less friction. That system does not currently exist anywhere. The pure mechanism has been producing the dichotomy of extraction-or-gatekeeping for as long as modern healthcare has existed. The augmentations are what would produce the third option.

The same methodology that closed MEV extraction, made stablecoin attribution honest, and corrected the development-loop failure modes would close the failure modes that hurt people every day in healthcare. The substrate is harder by orders of magnitude. The methodology is the same.

---

*The patient doesn't care about the institutional politics. The patient cares whether they get well, what it cost, and whether anyone treated them like a customer instead of a residual. The augmented system answers all three.*
