/** 进程级运行时状态（重启即重置，见 docs/01 §6.1 说明） */
export const runtime = {
  /** JWT 签名密钥，启动时从 data/jwt.secret 载入 */
  jwtSecret: null,
  /** 已吊销的 jti 集合（登出） */
  revokedJti: new Set(),
  /** 此时间戳之前签发的令牌一律失效（更换主密码后置位） */
  tokenNotBefore: 0,
};

export default runtime;
