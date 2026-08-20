// M4-2 单位系统：风/温度显示单位换算。
// 数据内部始终存 m/s 与 K，只在展示层（读数卡/图例）按用户选择换算。

export type WindUnit = 'ms' | 'kmh' | 'kt';
export type TempUnit = 'c' | 'f';

export const WIND_UNITS: { id: WindUnit; label: string }[] = [
  { id: 'ms', label: 'm/s' },
  { id: 'kmh', label: 'km/h' },
  { id: 'kt', label: '节' },
];

export const TEMP_UNITS: { id: TempUnit; label: string }[] = [
  { id: 'c', label: '℃' },
  { id: 'f', label: '℉' },
];

/** 风速 m/s -> 显示单位 */
export function windSpeed(mps: number, unit: WindUnit): number {
  if (unit === 'kmh') return mps * 3.6;
  if (unit === 'kt') return mps * 1.943844;
  return mps;
}

export function windUnitLabel(unit: WindUnit): string {
  return unit === 'kmh' ? 'km/h' : unit === 'kt' ? '节' : 'm/s';
}

/** 温度 ℃ -> 显示单位（数据存 K，读数卡已先转 ℃） */
export function tempFromC(c: number, unit: TempUnit): number {
  if (unit === 'f') return (c * 9) / 5 + 32;
  return c;
}

/** 温度 K -> 显示单位（图例量程直接用 K） */
export function tempFromK(k: number, unit: TempUnit): number {
  return tempFromC(k - 273.15, unit);
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === 'f' ? '℉' : '℃';
}
