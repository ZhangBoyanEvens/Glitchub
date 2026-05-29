/**
 * 无法从 Steam API 解析容量时的手工补充（需注明来源，勿臆测）。
 * bytes：安装/下载占用字节（十进制 GB=1e9）。
 */
export const MANUAL_REFERENCE_GAME_SIZES = {
  饥荒: {
    bytes: 3_000_000_000,
    source: 'Steam 商店页系统需求约 3 GB 可用空间（app 322330）',
  },
  星露谷: {
    bytes: 500_000_000,
    source: 'Steam 商店页系统需求约 500 MB（app 413150）',
  },
  GTA5: {
    bytes: 95_000_000_000,
    source: 'Steam 商店页约 95 GB 可用空间（app 271590）',
  },
  Palia: {
    bytes: 15_000_000_000,
    source: 'Steam 商店页约 15 GB（app 1786180）',
  },
  袜罪并罚: {
    bytes: 8_000_000_000,
    source: 'Steam 商店页 Socks the Lost 约 8 GB（app 3566500）',
  },
  乞丐模拟器: {
    bytes: 6_500_000_000,
    source: 'Steam 商店页 Bum Simulator 约 6.5 GB（app 871720）',
  },
  'PCL2 MC': {
    bytes: 500_000_000,
    source: 'PCL2 启动器本体体积（不含完整 Minecraft 资源包）',
  },
  腾讯斗地主: {
    bytes: 500_000_000,
    source: '腾讯游戏手游客户端常见包体量级（非 Steam）',
  },
  泰拉瑞亚: {
    bytes: 4_000_000_000,
    source: 'Steam 商店页存储空间约 4 GB（app 105600）',
  },
  '左 4 死 2': {
    bytes: 13_000_000_000,
    source: 'Steam 商店页存储空间约 13 GB（app 550）',
  },
  人类一败涂地: {
    bytes: 2_000_000_000,
    source: 'Steam 商店页存储空间约 2 GB（app 477160）',
  },
  恐鬼症: {
    bytes: 21_000_000_000,
    source: 'Steam 商店页存储空间约 21 GB（app 739630）',
  },
  'PICO park': {
    bytes: 500_000_000,
    source: 'Steam 商店页存储空间约 500 MB（app 1509960）',
  },
  '胡闹厨房 2': {
    bytes: 4_000_000_000,
    source: 'Steam 商店页存储空间约 4 GB（app 728880）',
  },
  致命公司: {
    bytes: 4_000_000_000,
    source: 'Steam 商店页存储空间约 4 GB（app 1966720）',
  },
  森林之子: {
    bytes: 20_000_000_000,
    source: 'Steam 商店页存储空间约 20 GB（app 1326470）',
  },
  'Among us': {
    bytes: 250_000_000,
    source: 'Steam 商店页存储空间 250 MB（app 945360）',
  },
  'casino simulator': {
    bytes: 8_000_000_000,
    source: 'Steam 商店页 Casino Simulator 约 8 GB（app 270130）',
  },
  '方舟：生存进化': {
    bytes: 60_000_000_000,
    source: 'Steam 商店页存储空间约 60 GB（app 346110）',
  },
  帕鲁: {
    bytes: 40_000_000_000,
    source: 'Steam 商店页存储空间约 40 GB（app 1623730）',
  },
  raft: {
    bytes: 10_000_000_000,
    source: 'Steam 商店页存储空间约 10 GB（app 648800）',
  },
  'ready or not': {
    bytes: 60_000_000_000,
    source: 'Steam 商店页存储空间约 60 GB（app 1144200）',
  },
  僵尸世界大战: {
    bytes: 50_000_000_000,
    source: 'Steam 商店页存储空间约 50 GB（app 699130）',
  },
  'squad（战术小队）': {
    bytes: 65_000_000_000,
    source: 'Steam 商店页存储空间约 65 GB（app 393380）',
  },
  潜渊症: {
    bytes: 2_000_000_000,
    source: 'Steam 商店页存储空间约 2 GB（app 602960）',
  },
  骗子酒馆: {
    bytes: 15_000_000_000,
    source: 'Steam 商店页存储空间约 15 GB（app 3097560）',
  },
  Peak: {
    bytes: 6_000_000_000,
    source: 'Steam 商店页存储空间约 6 GB（app 3527290）',
  },
  胖揍派对: {
    bytes: 10_000_000_000,
    source: 'Steam 商店页存储空间约 10 GB（app 509980）',
  },
  逃离后室: {
    bytes: 25_000_000_000,
    source: 'Steam 商店页存储空间约 25 GB（app 1943950）',
  },
  前方高能: {
    bytes: 5_000_000_000,
    source: 'Steam 商店页存储空间约 5 GB（app 1244090）',
  },
  'Chain tgt': {
    bytes: 8_000_000_000,
    source: 'Steam 商店页存储空间约 8 GB（app 2567870）',
  },
  'Keep Exploding no Talking': {
    bytes: 500_000_000,
    source: 'Steam 商店页存储空间约 500 MB（app 2797340）',
  },
  'RV There Yet?': {
    bytes: 1_000_000_000,
    source: 'Steam 商店页存储空间约 1 GB（app 2644470）',
  },
  Repo: {
    bytes: 1_000_000_000,
    source: 'Steam 商店页存储空间约 1 GB（app 3241660）',
  },
  盗窃地精: {
    bytes: 5_000_000_000,
    source: 'Steam 商店页 Burglin Gnomes 约 5 GB（app 3844970）',
  },
  'Shift at Midnight（Demo）': {
    bytes: 6_000_000_000,
    source: 'Steam 商店页存储空间约 6 GB（app 2825530）',
  },
  'SOS OPS': {
    bytes: 2_000_000_000,
    source: 'Steam 商店页 SOS OPS! 约 2 GB（app 2475460）',
  },
  '文明 6': {
    bytes: 23_000_000_000,
    source: 'Steam 商店页存储空间约 23 GB（app 289070）',
  },
  Payday2: {
    bytes: 83_000_000_000,
    source: 'Steam 商店页存储空间 83 GB（app 218620）',
  },
  '恶魔轮盘（CD期）': {
    bytes: 500_000_000,
    source: 'Steam 商店页 Buckshot Roulette 约 500 MB（app 2835570）',
  },
}
