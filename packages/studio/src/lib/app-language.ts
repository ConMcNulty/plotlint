// 全局应用语言：非 React 模块（store slice、parts-builder、error-copy 等）无法用
// useI18n hook，从这里读取。App.tsx 在项目配置加载/切换语言时调用 setAppLanguage 同步。
export type AppLanguage = "zh" | "en";

let current: AppLanguage = "en";

export function setAppLanguage(lang: AppLanguage): void {
  current = lang;
}

export function getAppLanguage(): AppLanguage {
  return current;
}

/** 内联双语：tr("中文", "English")。plotlint 默认英文；项目语言为 zh 时才显示中文。 */
export function tr(zh: string, en: string): string {
  return current === "en" ? en : zh;
}
