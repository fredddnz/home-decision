export const riskProbabilityLabel=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?`${(100*value).toFixed(1)}%`:'unassessed';
export function riskExplanation(risk){
 if(riskProbabilityLabel(risk.posterior)==='unassessed')return `No applicable posterior: ${risk.state??'unassessed'}. Missing or conflicting evidence does not become a reassuring probability. The neutral prior is not a measured property probability.`;
 return `Uncalibrated conditional scenario: prior assumption ${riskProbabilityLabel(risk.prior)}, selected likelihood ratio ${risk.likelihoodRatio}, posterior ${riskProbabilityLabel(risk.posterior)}. This is not a measured property-risk estimate or professional clearance. Parameter sensitivity ${riskProbabilityLabel(risk.sensitivity?.lower)}–${riskProbabilityLabel(risk.sensitivity?.upper)}; not a credible interval. Purchase support remains a separate weighted utility.`;
}
