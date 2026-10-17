// Explain only the actual failure in the inspected comparison component.
export function ahpFailureExplanation(ahp,component){
 if(ahp?.status!=='inconsistent'||!component?.inconsistent)return null;
 if(!component.converged)return 'The AHP calculation for this comparison group did not converge. Fallback weights remain active pending review.';
 if(component.complete&&component.consistencyRatio>ahp.policy.consistencyLimit)return `This ${ahp.complete?'complete matrix':'component'} CR ${component.consistencyRatio.toFixed(4)} exceeds the ${ahp.policy.consistencyLimit} limit. Clarify its comparisons before applying AHP weights.${ahp.complete?'':' Full-matrix CR remains unavailable while comparisons are missing.'}`;
 if(!component.complete&&component.maxMismatchFactor>ahp.policy.partialMismatchLimit)return `This incomplete group has an observed-edge ratio mismatch of ${Number(component.maxMismatchFactor.toFixed(4))}, which exceeds the ${ahp.policy.partialMismatchLimit} product-screen limit. Clarify its comparisons; this screen is not CR or a confidence estimate.`;
 return null;
}
