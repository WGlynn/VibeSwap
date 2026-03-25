"""
Guardian Collusion Analysis — Adversarial search for wallet recovery.

CRITICAL GAP from coverage matrix: guardian collusion not tested anywhere.

Models:
- 3-of-5 guardian threshold
- 24h notification delay
- Bond slashing on cancellation
- Owner online/offline probability

Searches for:
- Minimum collusion cost (bond needed to make collusion irrational)
- Sleeping owner vulnerability window
- Guardian add/remove gaming
- Optimal guardian set size
"""

from dataclasses import dataclass
from typing import List, Tuple
import itertools


@dataclass
class Guardian:
    addr: str
    bond: int           # Bond posted (slashed on failed recovery)
    is_colluding: bool
    relationship: str   # "family", "friend", "lawyer", "service"


@dataclass
class WalletState:
    owner_addr: str
    wallet_value: int                # Total value in wallet
    guardians: List[Guardian]
    threshold: int                   # M-of-N required
    notification_delay: int          # Seconds (24h = 86400)
    owner_check_interval: int        # How often owner checks (seconds)
    bond_per_guardian: int           # Bond each guardian posts


@dataclass
class CollusionResult:
    can_collude: bool
    colluding_guardians: List[str]
    profit_per_colluder: int         # Net profit after bond loss
    owner_can_cancel: bool           # Owner online in time?
    time_to_execute: int             # Seconds until funds drained
    bond_slashed: int                # Total bond lost if caught
    economic_rationality: float      # profit / risk ratio


class GuardianCollusionSearch:
    """
    Exhaustive search over guardian collusion scenarios.
    For small N (3-7 guardians), enumerate ALL possible coalitions.
    """

    def analyze(self, state: WalletState) -> List[CollusionResult]:
        results = []
        n = len(state.guardians)

        # Try every coalition of size >= threshold
        for k in range(state.threshold, n + 1):
            for coalition in itertools.combinations(range(n), k):
                guardians_in_coalition = [state.guardians[i] for i in coalition]

                # All must be colluding
                colluding_addrs = [g.addr for g in guardians_in_coalition]

                # Bond at risk
                total_bond = sum(g.bond for g in guardians_in_coalition)

                # Profit if successful: wallet_value / num_colluders
                profit_per = state.wallet_value // k

                # Owner cancellation probability
                # If owner checks every `owner_check_interval` seconds,
                # probability of catching = 1 - P(asleep for entire delay)
                # Simple model: owner checks uniformly, miss probability =
                # (delay - check_interval) / delay if check < delay
                if state.owner_check_interval <= state.notification_delay:
                    owner_catches = True
                else:
                    owner_catches = False

                # Net profit = wallet_value / k - bond (if caught)
                if owner_catches:
                    net_profit = -total_bond // k  # Lose bond, get nothing
                else:
                    net_profit = profit_per  # Get share of wallet

                # Economic rationality: expected value
                # P(owner catches) * (-bond/k) + P(owner misses) * (wallet/k)
                p_catch = min(1.0, state.notification_delay / max(state.owner_check_interval, 1))
                ev = p_catch * (-total_bond / k) + (1 - p_catch) * profit_per

                results.append(CollusionResult(
                    can_collude=(k >= state.threshold),
                    colluding_guardians=colluding_addrs,
                    profit_per_colluder=net_profit,
                    owner_can_cancel=owner_catches,
                    time_to_execute=state.notification_delay,
                    bond_slashed=total_bond if owner_catches else 0,
                    economic_rationality=ev / max(state.wallet_value, 1),
                ))

        return results

    def find_minimum_bond(self, wallet_value: int, threshold: int, n_guardians: int,
                          owner_check_hours: int = 12) -> int:
        """
        Find minimum bond per guardian that makes collusion irrational.
        Collusion is irrational when EV < 0 for all possible coalitions.
        """
        owner_check_seconds = owner_check_hours * 3600
        notification_delay = 86400  # 24h

        for bond in range(0, wallet_value, wallet_value // 100 or 1):
            guardians = [
                Guardian(f"g{i}", bond, False, "friend")
                for i in range(n_guardians)
            ]
            state = WalletState(
                owner_addr="owner",
                wallet_value=wallet_value,
                guardians=guardians,
                threshold=threshold,
                notification_delay=notification_delay,
                owner_check_interval=owner_check_seconds,
                bond_per_guardian=bond,
            )

            results = self.analyze(state)
            all_irrational = all(r.economic_rationality <= 0 for r in results)

            if all_irrational:
                return bond

        return wallet_value  # Bond must equal wallet value (extreme)

    def analyze_sleeping_owner(self, wallet_value: int, threshold: int = 3,
                                n_guardians: int = 5) -> dict:
        """
        Analyze vulnerability window as a function of owner offline duration.
        """
        results = {}
        notification_delay = 86400

        for hours_offline in [1, 6, 12, 24, 48, 72, 168, 720]:
            bond = self.find_minimum_bond(
                wallet_value, threshold, n_guardians,
                owner_check_hours=hours_offline
            )
            results[hours_offline] = {
                "hours_offline": hours_offline,
                "min_bond_for_safety": bond,
                "bond_as_pct_of_wallet": round(bond * 100 / wallet_value, 1) if wallet_value > 0 else 0,
                "safe": bond < wallet_value,
            }

        return results

    def analyze_add_remove_gaming(self, wallet_value: int) -> dict:
        """
        Can an attacker add colluding guardians, then trigger recovery?
        Assumes: adding a guardian requires owner signature + cooldown.
        """
        # If guardians can be added without cooldown, attacker who
        # compromises owner key can add 3 colluding guardians and
        # immediately trigger recovery. The 24h delay is the ONLY defense.
        return {
            "attack": "add 3 colluding guardians then recover",
            "requires": "owner key compromise",
            "defense": "24h notification delay + guardian addition cooldown",
            "recommendation": "guardian additions should have >= 48h cooldown, "
                            "exceeding the notification delay",
            "current_vulnerability": "if no cooldown on guardian add, "
                                   "owner key compromise = wallet compromise",
        }


def run_full_analysis():
    search = GuardianCollusionSearch()

    print("=" * 60)
    print("GUARDIAN COLLUSION ANALYSIS")
    print("=" * 60)

    # Standard scenario: $100K wallet, 3-of-5 guardians
    wallet_value = 100_000 * 10**18  # $100K in wei
    threshold = 3
    n_guardians = 5

    print(f"\nScenario: ${wallet_value // 10**18:,} wallet, {threshold}-of-{n_guardians} guardians")

    # Minimum bond analysis
    print("\n--- Minimum Bond for Collusion Irrationality ---")
    for check_hours in [1, 6, 12, 24, 48]:
        bond = search.find_minimum_bond(wallet_value, threshold, n_guardians, check_hours)
        pct = round(bond * 100 / wallet_value, 1)
        print(f"  Owner checks every {check_hours}h: min bond = ${bond // 10**18:,} ({pct}% of wallet)")

    # Sleeping owner analysis
    print("\n--- Sleeping Owner Vulnerability ---")
    sleeping = search.analyze_sleeping_owner(wallet_value, threshold, n_guardians)
    for hours, data in sleeping.items():
        status = "SAFE" if data["safe"] else "VULNERABLE"
        print(f"  {hours}h offline: bond needed = {data['bond_as_pct_of_wallet']}% of wallet [{status}]")

    # Add/remove gaming
    print("\n--- Guardian Add/Remove Gaming ---")
    gaming = search.analyze_add_remove_gaming(wallet_value)
    print(f"  Attack: {gaming['attack']}")
    print(f"  Requires: {gaming['requires']}")
    print(f"  Defense: {gaming['defense']}")
    print(f"  Recommendation: {gaming['recommendation']}")

    return sleeping, gaming


if __name__ == "__main__":
    run_full_analysis()
