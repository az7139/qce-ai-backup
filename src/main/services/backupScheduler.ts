import type { BackupPlan } from '../types/config';

export function getDueStartupPlans(plans: BackupPlan[]): BackupPlan[] {
  return plans.filter((plan) => {
    if (!plan.enabled) return false;
    if (!plan.schedule.autoRunOnAppLaunch) return false;
    return plan.schedule.type === 'startup';
  });
}
