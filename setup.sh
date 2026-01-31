#!/bin/bash

# VibeSwap Setup Script
# Run this after cloning the repo to install dependencies

echo "Installing Foundry dependencies..."

# Install forge-std
forge install foundry-rs/forge-std --no-commit

# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.0.1 --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.0.1 --no-commit

echo "Building contracts..."
forge build

echo "Running tests..."
forge test

echo "Setup complete!"
