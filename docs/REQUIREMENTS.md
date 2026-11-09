# 需求与交付映射

| 用户原始需求 | 页面 / 模块 / 文档 |
| --- | --- |
| 结合两个文档整理 GitHub 开源项目 | 独立目录、README、API矩阵、MIT、CI、贡献/安全文档 |
| 本地启动 | bin/stepx.js serve、src/server.js、web/；不依赖外层平台 |
| 输入账号、密码或者验证码后拿到 Cookie | 官方浏览器登录、短信协议、手动导入/显式导出；原资料没有密码API，密码仅在官方支持的界面输入 |
| 打开任务签到页面 | 官方有头 Chromium、任务中心链接，不向URL附加token |
| 支持签到完成任务 | 每日签到及奖励核验；其他任务真实条件由官方判断，无任意任务完成API |
| 按照步骤执行脚本完成签到 | workflow inspect / enter / sign / verify / all |
| 完善SDK，其他接口同步实现 | 44接口、类型声明、通用call、multipart、二进制thumbnail、附件重绑、错误/超时/节流 |
| 定时任务 | Web每日计划、CLI常驻、系统cron/systemd示例，持久化当日标记 |
| 可视化和命令行 | Web登录/任务/全量API/计划/记录；CLI相同核心功能 |
| 补充短信登录脚本 | 安全HttpSession、加密信封、手动验证码、风控停止、Studio/任务分别验证 |

未修改外层移动App、capsule/、Supabase、capability.json：本交付为独立本地Node项目，无原生壳能力、平台认证或平台插件/连接器接入；无需更改外层能力声明与屏幕方向。当前会话未提供App Creator技能，故未假称执行其平台门禁；本项目使用独立测试与构建。
