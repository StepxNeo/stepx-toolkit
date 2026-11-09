# 参考来源（不属于本项目 MIT 授权）

- [StepX 接口文档.md](https://static.919900755.xyz/view/StepX%20%E6%8E%A5%E5%8F%A3%E6%96%87%E6%A1%A3.md)，原文件 `/files/StepX%20%E6%8E%A5%E5%8F%A3%E6%96%87%E6%A1%A3.md`，文内整理时间 2026-10-19。
- [StepX 统一接口 SDK.js](https://static.919900755.xyz/view/StepX%20%E7%BB%9F%E4%B8%80%E6%8E%A5%E5%8F%A3%20SDK.js)，对应 `/files/` 原件。
- 用户在本次会话提供的 Node20+ 短信登录协议脚本，注释快照 2026-11-06。实现入口为 `src/sms-login.js`，依赖的 HTTP 会话在本项目中实现。

原资料区分“实测 / 代码确认 / 推断”；本项目保留此标记，不把资料中的实测等同于当前账号真实验证。发现原始SDK task.sign误用默认GET，已按接口文档改为POST空对象；补齐原SDK未实现的附件重绑和素材缩略图，所有44项由测试逐项确认请求构造。

本地下载的 upstream-api.md / upstream-sdk.js 仅用于对照，因上游未附许可证，已加入 .gitignore；不要在取得授权前将这些原件上传开源仓库。原创实现独立编写，MIT仅覆盖原创文件。参考地址可用性和官方接口稳定性不作保证。
