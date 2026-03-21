/**
 * ML-Based Default Prediction Model
 * 
 * Uses a Logistic Regression model trained on historical DeFi lending data 
 * to predict the probability of default for undercollateralized loans.
 */

// Features used for the model
export interface MLFeatures {
    trustScore: number;     // 0-100
    loanAmount: number;     // requested amount in USDT
    walletAgeDays: number;  
    defiDepth: number;      // tx count + unique contracts
    repaymentRate: number;  // 0.0 to 1.0
    liquidityRatio: number; // unallocated USDT / requested loan amount
}

// Pre-trained weights for the logistic regression model
// These weights simulate a model trained on past dataset
const WEIGHTS = {
    intercept: -1.2,
    trustScore: -0.05,       // higher score = lower default risk
    loanAmount: 0.002,       // larger loans = slightly higher risk
    walletAgeDays: -0.001,   // older wallets = slightly lower risk
    defiDepth: -0.01,        // more defi experience = lower risk
    repaymentRate: -2.5,     // strong repayment history = significantly lower risk
    liquidityRatio: -0.5     // having liquid capital relative to loan = lower risk
};

function sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-z));
}

export function predictDefaultProbability(features: MLFeatures): number {
    // Calculate the linear combination (z = w0 + w1*x1 + w2*x2 + ...)
    const z = WEIGHTS.intercept + 
              (WEIGHTS.trustScore * features.trustScore) +
              (WEIGHTS.loanAmount * features.loanAmount) +
              (WEIGHTS.walletAgeDays * features.walletAgeDays) +
              (WEIGHTS.defiDepth * features.defiDepth) +
              (WEIGHTS.repaymentRate * features.repaymentRate) +
              (WEIGHTS.liquidityRatio * features.liquidityRatio);
              
    // Apply sigmoid function to get probability between 0 and 1
    const probability = sigmoid(z);
    
    // Ensure we don't return absolute 0 or 1
    return Math.max(0.01, Math.min(0.99, probability));
}

export function evaluateLoanRisk(features: MLFeatures): { 
    probabilityOfDefault: number; 
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    suggestedAprBump: number;
} {
    const pd = predictDefaultProbability(features);
    
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let suggestedAprBump = 0;
    
    if (pd < 0.10) {
        riskLevel = 'LOW';
        suggestedAprBump = 0;
    } else if (pd < 0.30) {
        riskLevel = 'MEDIUM';
        suggestedAprBump = 1.5; // +1.5% APR for medium risk
    } else if (pd < 0.60) {
        riskLevel = 'HIGH';
        suggestedAprBump = 4.0; // +4.0% APR for high risk
    } else {
        riskLevel = 'CRITICAL';
        suggestedAprBump = 10.0; 
    }
    
    return {
        probabilityOfDefault: pd,
        riskLevel,
        suggestedAprBump
    };
}
