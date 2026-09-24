import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installDiagLog } from "./diagLog";
import { initRipple } from "./4ebuild/lib/ripple";
import { initOverlayLock } from "./4ebuild/lib/overlayLock";

// 应用启动即安装程序日志收集（console / 全局错误），供「导出程序日志」使用
installDiagLog();

// 车卡器交互增强（全局事件委托，弹层渲染在 document.body 下必须全局安装）：
// - initRipple：MD3 水波纹；宿主按钮命中的 ink 节点由 styles.css 的兜底规则
//   （0s 动画立即触发 animationend）自移除，无可见副作用
// - initOverlayLock：自定义弹层打开期间锁定页面滚动（md-dialog 走浏览器原生模态）
initRipple();
initOverlayLock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
