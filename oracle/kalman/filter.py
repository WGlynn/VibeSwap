"""
Kalman filter for True Price estimation.

State vector: [P_true, drift]
- P_true: Latent equilibrium price
- drift: Long-term trend component (mean-reverting)

Key features:
- Time-varying observation noise (R) based on leverage stress + USDT flows
- Time-varying process noise (Q) based on USDC confirmation
- Multi-venue observations with reliability weighting
"""

import numpy as np
from typing import Tuple, Optional
from scipy import stats

from ..config import KalmanConfig
from ..models.stablecoin import StablecoinState
from .covariance import CovarianceManager


class TruePriceKalmanFilter:
    """
    Kalman filter for True Price estimation with stablecoin dynamics.
    """

    def __init__(self, config: KalmanConfig, initial_price: Optional[float] = None):
        """
        Initialize Kalman filter.

        Args:
            config: Kalman filter configuration
            initial_price: Initial price estimate (overrides config if provided)
        """
        self.config = config

        # State vector: [true_price, drift]
        price = initial_price if initial_price is not None else config.initial_price
        self.x = np.array([price, config.initial_drift])

        # State covariance matrix
        self.P = np.array([
            [config.initial_price_var, 0],
            [0, config.initial_drift_var]
        ])

        # State transition matrix: x(t) = F * x(t-1) + noise
        # True price inherits drift, drift is mean-reverting
        self.F = np.array([
            [1, 1],  # P_true(t) = P_true(t-1) + drift(t-1)
            [0, config.drift_persistence]  # drift(t) = rho * drift(t-1)
        ])

        # Base process noise covariance
        self.Q_base = np.array([
            [config.process_noise_price, 0],
            [0, config.process_noise_drift]
        ])

        # Prediction state (stored between predict and update)
        self.x_pred = None
        self.P_pred = None

        # Covariance manager for dynamic adjustments
        self.cov_manager = CovarianceManager(config)

    @property
    def true_price(self) -> float:
        """Current True Price estimate"""
        return self.x[0]

    @property
    def drift(self) -> float:
        """Current drift estimate"""
        return self.x[1]

    @property
    def true_price_std(self) -> float:
        """Standard deviation of True Price estimate"""
        return np.sqrt(self.P[0, 0])

    def predict(self, stablecoin_state: Optional[StablecoinState] = None) -> float:
        """
        Prediction step: propagate state forward.

        Adjust process noise based on stablecoin dynamics:
        - USDC-confirmed trends allow faster True Price drift
        - Otherwise, True Price is slow-moving

        Args:
            stablecoin_state: Current stablecoin flow state

        Returns:
            Predicted True Price
        """
        # Compute dynamic process noise
        Q = self.cov_manager.compute_process_noise(self.Q_base, stablecoin_state)

        # State prediction: x_pred = F * x
        self.x_pred = self.F @ self.x

        # Covariance prediction: P_pred = F * P * F' + Q
        self.P_pred = self.F @ self.P @ self.F.T + Q

        return self.x_pred[0]

    def update(
        self,
        observations: np.ndarray,
        observation_variances: np.ndarray
    ) -> Tuple[float, float]:
        """
        Update step: incorporate new observations.

        Args:
            observations: Array of venue prices + realized price
            observation_variances: Array of venue-specific variances (time-varying!)

        Returns:
            Tuple of (true_price_estimate, true_price_std)
        """
        if self.x_pred is None or self.P_pred is None:
            raise RuntimeError("Must call predict() before update()")

        n_obs = len(observations)

        # Observation matrix: all observations measure True Price (first state element)
        H = np.zeros((n_obs, 2))
        H[:, 0] = 1

        # Observation noise covariance (diagonal, time-varying)
        R = np.diag(observation_variances)

        # Innovation (measurement residual)
        y_pred = H @ self.x_pred
        innovation = observations - y_pred

        # Innovation covariance
        S = H @ self.P_pred @ H.T + R

        # Kalman gain
        K = self.P_pred @ H.T @ np.linalg.inv(S)

        # State update
        self.x = self.x_pred + K @ innovation

        # Covariance update (Joseph form for numerical stability)
        I = np.eye(2)
        self.P = (I - K @ H) @ self.P_pred @ (I - K @ H).T + K @ R @ K.T

        return self.x[0], np.sqrt(self.P[0, 0])

    def get_confidence_interval(self, confidence: float = 0.95) -> Tuple[float, float]:
        """
        Return confidence interval for True Price.

        Args:
            confidence: Confidence level (default 95%)

        Returns:
            Tuple of (lower_bound, upper_bound)
        """
        z = stats.norm.ppf((1 + confidence) / 2)
        std = np.sqrt(self.P[0, 0])

        return (self.x[0] - z * std, self.x[0] + z * std)

    def compute_deviation_zscore(self, spot_price: float) -> float:
        """
        Compute z-score of spot price deviation from True Price.

        Args:
            spot_price: Current spot price

        Returns:
            Z-score (positive if spot > true, negative if spot < true)
        """
        std = np.sqrt(self.P[0, 0])
        if std == 0:
            return 0.0

        return (spot_price - self.x[0]) / std

    def reset(self, initial_price: float, initial_drift: float = 0.0):
        """
        Reset filter state.

        Args:
            initial_price: New initial price
            initial_drift: New initial drift
        """
        self.x = np.array([initial_price, initial_drift])
        self.P = np.array([
            [self.config.initial_price_var, 0],
            [0, self.config.initial_drift_var]
        ])
        self.x_pred = None
        self.P_pred = None
