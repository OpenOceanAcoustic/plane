/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export default function InstanceAuthenticationPage() {
  return (
    <section className="max-w-2xl p-6 text-primary">
      <h1 className="text-20 font-semibold">实验室认证</h1>
      <p className="mt-4 text-14 text-secondary">
        已启用用户名与 Authenticator 动态码登录。成员注册须使用管理员从服务器终端发放的一次性邀请链接。
      </p>
      <p className="mt-3 text-14 text-secondary">
        新增邀请、撤销邀请和重新绑定 Authenticator 均由服务器终端管理；网页不提供自助注册或管理员初始化。
      </p>
    </section>
  );
}
