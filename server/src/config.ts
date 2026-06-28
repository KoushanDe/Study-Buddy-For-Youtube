export interface RegenerateConfig {
  successDailyLimit: number
  deniedDailyLimit: number
  cooldownHours: number
  validationModel: string
}

export function getRegenerateConfig(): RegenerateConfig {
  return {
    successDailyLimit: Number(process.env.REGENERATE_SUCCESS_DAILY_LIMIT ?? 5),
    deniedDailyLimit: Number(process.env.REGENERATE_DENIED_DAILY_LIMIT ?? 3),
    cooldownHours: Number(process.env.REGENERATE_COOLDOWN_HOURS ?? 24),
    validationModel: process.env.GEMINI_VALIDATION_MODEL ?? 'gemini-2.5-flash-lite',
  }
}
