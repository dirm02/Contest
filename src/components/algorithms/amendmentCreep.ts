interface ContractAction {
  id: string;
  amount: number;
  isCompetitive: boolean;
  date: Date;
}

interface ProcurementContract {
  contractId: string;
  vendorId: string;
  originalAmount: number;
  currentTotalAmount: number;
  isOriginalBidCompetitive: boolean;
  history: ContractAction[];
}

interface RiskAnalysis {
  contractId: string;
  creepRatio: number; // Current Total / Original
  isThresholdSplitter: boolean;
  isLandAndExpand: boolean;
  riskScore: number; // 0 to 100
}

const COMPETITIVE_THRESHOLD = 25000; // Example threshold

export default function analyzeAmendmentCreep(contracts: ProcurementContract[]): RiskAnalysis[] {
  return contracts.map(contract => {
    const creepRatio = contract.currentTotalAmount / contract.originalAmount;
    
    // Pattern 1: Threshold Splitting
    // Checks if the original bid was suspiciously close (within 5%) to the competitive limit
    const isThresholdSplitter = 
      contract.originalAmount < COMPETITIVE_THRESHOLD && 
      contract.originalAmount > (COMPETITIVE_THRESHOLD * 0.95);

    // Pattern 2: Land and Expand
    // Original was competitive, but the vast majority of value came from non-competitive amendments
    const nonCompetitiveValue = contract.history
      .filter(a => !a.isCompetitive)
      .reduce((sum, a) => sum + a.amount, 0);
    
    const isLandAndExpand = 
      contract.isOriginalBidCompetitive && 
      nonCompetitiveValue > contract.originalAmount;

    // Calculate Aggregate Risk Score
    let riskScore = 0;
    if (creepRatio > 2) riskScore += 40; // Value doubled
    if (isThresholdSplitter) riskScore += 30;
    if (isLandAndExpand) riskScore += 30;

    return {
      contractId: contract.contractId,
      creepRatio,
      isThresholdSplitter,
      isLandAndExpand,
      riskScore: Math.min(riskScore, 100)
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
}