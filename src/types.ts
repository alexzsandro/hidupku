export type Status = 'todo' | 'in_progress' | 'done'
export type Kind = 'one_time' | 'recurring'
export interface Task { id: string; title: string; notes: string | null; weight: 1 | 2 | 3; kind: Kind; scheduled_date: string | null; recurrence_days: number[]; is_archived: boolean }
export interface Occurrence { id: string; task_id: string; occurrence_date: string; title: string; notes: string | null; weight: 1 | 2 | 3; status: Status; focus_rank: number | null; completed_at: string | null }
export interface DailyStat { stat_date: string; total_points: number; completed_points: number; xp_earned: number; goal_reached: boolean }
