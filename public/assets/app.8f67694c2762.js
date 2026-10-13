/* =====================================================================
   PITCHSIDE PROTOTYPE — DATA LAYER
   Everything here maps to the spec's core entities (section 35).
   In production these come from the API; here they live in memory.
   ===================================================================== */
const NOW = Date.now();
const MIN = 60e3, HR = 60*MIN, DAY = 24*HR;
const ago = ms => NOW - ms;

/* ---------- Roles & permission matrix (spec §18, §19) ---------- */
const ROLES = [
  {id:"guest",            label:"Guest"},
  {id:"new_member",       label:"New Member"},
  {id:"member",           label:"Member"},
  {id:"trusted",          label:"Trusted Member"},
  {id:"verified_reviewer",label:"Verified Reviewer"},
  {id:"verified_seller",  label:"Verified Member"},
  {id:"business",         label:"Business Account"},
  {id:"moderator",        label:"Moderator"},
  {id:"senior_moderator", label:"Senior Moderator"},
  {id:"admin",            label:"Admin"},
  {id:"super_admin",      label:"Super Admin"}
];
const roleLabel = id => (ROLES.find(r => r.id === id) || {label:id}).label;

// 1 = allowed, "r" = restricted, 0 = not allowed. Admin can edit this table (Admin → Permissions).
const CAPS = [
  {id:"read",          label:"Read public boards"},
  {id:"topic",         label:"Create topics"},
  {id:"links",         label:"Post links"},
  {id:"pm",            label:"Private messages"},
  {id:"review",        label:"Create reviews"},
  {id:"verifiedReview",label:"Verified reviews"},
  {id:"listing",       label:"Marketplace listing"},
  {id:"claimBusiness", label:"Claim business profile"},
  {id:"respondBusiness",label:"Respond to business review"},
  {id:"moderate",      label:"Moderate content"},
  {id:"manageCategories",label:"Manage categories"},
  {id:"managePermissions",label:"Manage permissions"},
  {id:"manageRatings", label:"Manage ratings rules"},
  {id:"system",        label:"System controls"}
];
const M = (g,n,m,t,vr,vs,b,mod,smod,a,sa) => ({guest:g,new_member:n,member:m,trusted:t,verified_reviewer:vr,verified_seller:vs,business:b,moderator:mod,senior_moderator:smod,admin:a,super_admin:sa});
const PERMS = {
  read:             M(1,1,1,1,1,1,1,1,1,1,1),
  topic:            M(0,"r",1,1,1,1,1,1,1,1,1),
  links:            M(0,"r",1,1,1,1,1,1,1,1,1),
  pm:               M(0,"r",1,1,1,1,1,1,1,1,1),
  review:           M(0,0,1,1,1,1,0,1,1,1,1),
  verifiedReview:   M(0,0,0,1,1,0,0,1,1,1,1),
  listing:          M(0,0,1,1,1,1,1,1,1,1,1),
  claimBusiness:    M(0,0,0,0,0,0,1,0,0,1,1),
  respondBusiness:  M(0,0,0,0,0,0,1,0,0,1,1),
  moderate:         M(0,0,0,0,0,0,0,1,1,1,1),
  manageCategories: M(0,0,0,0,0,0,0,0,0,1,1),
  managePermissions:M(0,0,0,0,0,0,0,0,0,1,1),
  manageRatings:    M(0,0,0,0,0,0,0,0,0,1,1),
  system:           M(0,0,0,0,0,0,0,0,0,0,1)
};
// What "restricted" means for New Members (configurable in Admin → Permissions)
const LIMITS = {newTopicsPerDay:2, newPmsPerDay:5, newMemberPostsToGraduate:10};

/* ---------- Moderator permissions ----------
   Every moderation action is its own permission key. Admins build
   templates (bundles of keys), assign each moderator a template plus the
   boards they cover, and can grant or revoke individual keys per person.
   Admins and Super Admins always have every key. */
const MOD_PERMS = [
  {group:"Topics", keys:[
    ["topic.pin","Pin and unpin topics"],["topic.lock","Lock and unlock topics"],["topic.move","Move topics between boards"],
    ["topic.merge","Merge and split topics"],["topic.archive","Archive topics"],["topic.tags","Edit topic tags"],
    ["topic.delete","Delete topics"],["topic.matchThread","Create match threads"]]},
  {group:"Posts", keys:[["post.edit","Edit other members' posts"],["post.hide","Hide and unhide posts"]]},
  {group:"Members", keys:[
    ["user.view","See staff details on profiles (warnings, status)"],["user.warn","Warn members"],["user.suspend","Suspend members"],
    ["user.ban","Ban members"],["user.restore","Lift suspensions and bans"],["user.appeals","Decide appeals"]]},
  {group:"Moderation queues", keys:[
    ["queue.reports","Reports"],["queue.spam","Spam"],["queue.scam","Scam accusations"],["queue.complaints","Casino complaints"],
    ["queue.review_disputes","Review disputes"],["queue.abuse","Abuse (incl. reported messages)"],["queue.market","Marketplace disputes"],
    ["queue.claims","Business claims"],["queue.appeals","Appeals"]]},
  {group:"Gambling & reviews", keys:[
    ["review.moderate","Change review status / remove reviews"],["complaint.manage","Change complaint status, read private evidence, add notes"],
    ["operator.warning","Set scam warning labels"],["business.verify","Approve business claims"]]},
  {group:"Marketplace", keys:[["queue.listings","Approve or reject new listings"],["listing.remove","Remove and restore listings"],["escrow.arbitrate","Decide escrow disputes (release or refund)"],["seller.verify","Verify members for the marketplace and revoke it"]]},
  {group:"Messages", keys:[["dm.anyone","Message members who have turned DMs off"],["dm.notice","Send official moderator notices"]]}
];
const ALL_MOD_KEYS = MOD_PERMS.flatMap(g => g.keys.map(k => k[0]));
const modLabel = k => (MOD_PERMS.flatMap(g=>g.keys).find(x=>x[0]===k) || [k,k])[1];
let MOD_TEMPLATES = [
  {id:"board", name:"Board moderator", desc:"Keeps assigned boards tidy. Can't ban.", allBoards:false,
   perms:new Set(["topic.pin","topic.lock","topic.move","topic.merge","topic.archive","topic.tags","topic.matchThread","post.edit","post.hide","user.view","user.warn","user.suspend","queue.reports","queue.spam","dm.notice"])},
  {id:"gambling", name:"Gambling moderator", desc:"Reviews, complaints and scam reports on gambling boards.", allBoards:false,
   perms:new Set(["topic.pin","topic.lock","topic.tags","post.hide","user.view","user.warn","queue.reports","queue.spam","queue.scam","queue.complaints","queue.review_disputes","review.moderate","complaint.manage","operator.warning","dm.notice"])},
  {id:"market", name:"Marketplace moderator", desc:"Listings and marketplace disputes.", allBoards:false,
   perms:new Set(["post.hide","user.view","user.warn","queue.reports","queue.spam","queue.market","queue.listings","listing.remove","escrow.arbitrate","seller.verify","dm.notice"])},
  {id:"senior", name:"Senior moderator", desc:"Every board, every queue, bans and appeals.", allBoards:true, perms:new Set(ALL_MOD_KEYS)}
];
// Per-moderator assignment. Boards come from each board's moderator list (Admin → Forum or here).
let MOD_PROFILES = {
  offside_ama:   {template:"board",    allow:new Set(), deny:new Set(), suspendMaxDays:7},
  xg_merchant:   {template:"board",    allow:new Set(), deny:new Set(["user.suspend"]), suspendMaxDays:7},
  courtside_kofi:{template:"board",    allow:new Set(), deny:new Set(), suspendMaxDays:3},
  satoshi_sub:   {template:"board",    allow:new Set(["queue.scam"]), deny:new Set(), suspendMaxDays:7},
  lineswoman:    {template:"senior",   allow:new Set(), deny:new Set(), suspendMaxDays:30}
};

/* ---------- Reputation ranks (spec §17) ---------- */
let RANKS = [
  {name:"New Member", min:0}, {name:"Member", min:10}, {name:"Active Member", min:50},
  {name:"Established Member", min:150}, {name:"Senior Member", min:400}, {name:"Veteran", min:1000},
  {name:"Community Expert", min:2500}, {name:"Community Leader", min:5000}
];
const rankFor = posts => RANKS.reduce((r,x) => posts >= x.min ? x.name : r, RANKS[0].name);

/* ---------- Users (users, user_profiles, user_roles, user_reputation, user_badges) ---------- */
const U = (name, role, o={}) => Object.assign({
  name, role, joined: ago(400*DAY), posts: 120, topics: 14, likes: 210,
  rep:{forum:40, market:0, review:0, prediction:null},
  badges:[], favTeams:[], favSports:[], about:"", website:"", avatar:null, avatarColor:null, sig:"", hideSigs:false,
  privacy:{dms:"members", showActivity:true}, status:"active", warnings:0,
  notify:{email:true, browser:true, push:false}, twoFA:false, verified:true
}, o);
const USERS = {
  rookie_ruth:   U("rookie_ruth","new_member",{joined:ago(3*DAY),posts:4,topics:1,likes:2,rep:{forum:1,market:0,review:0,prediction:null},favTeams:["hearts-of-oak"],favSports:["football"],about:"Just found this place. Phobia fan since primary school."}),
  kwame_fc:      U("kwame_fc","member",{joined:ago(540*DAY),posts:612,topics:48,likes:1310,rep:{forum:182,market:12,review:9,prediction:61},badges:["Match thread regular","Derby day"],favTeams:["arsenal","hearts-of-oak"],favSports:["football","basketball"],about:"Gooner in Accra. I argue about full-backs for fun.",website:"kwame.example"}),
  sharp_sam:     U("sharp_sam","trusted",{joined:ago(1300*DAY),posts:2780,topics:190,likes:5400,rep:{forum:640,market:44,review:58,prediction:72},badges:["Trusted","Top reviewer 2025"],favTeams:["celtics"],favSports:["basketball","football"],about:"Closing-line value or nothing."}),
  verified_vee:  U("verified_vee","verified_reviewer",{joined:ago(900*DAY),posts:830,topics:40,likes:1900,rep:{forum:210,market:5,review:170,prediction:null},badges:["Verified reviewer"],favSports:["tennis"]}),
  kitbag_kojo:   U("kitbag_kojo","verified_seller",{joined:ago(1100*DAY),posts:420,topics:60,likes:700,rep:{forum:95,market:230,review:4,prediction:null},badges:["Verified","50 trades"],favTeams:["asante-kotoko"],favSports:["football"],about:"Vintage kits and signed memorabilia. Proof of authenticity on every item."}),
  stakeline_rep: U("stakeline_rep","business",{joined:ago(200*DAY),posts:58,topics:2,likes:20,rep:{forum:6,market:0,review:0,prediction:null},badges:["Official representative"],business:"stakeline",about:"Official Stakeline support account. We answer complaints within 48h."}),
  offside_ama:   U("offside_ama","moderator",{joined:ago(1500*DAY),posts:4100,topics:260,likes:8800,rep:{forum:920,market:20,review:30,prediction:55},badges:["Moderator"],favTeams:["liverpool","hearts-of-oak"],favSports:["football"]}),
  lineswoman:    U("lineswoman","senior_moderator",{joined:ago(2100*DAY),posts:6900,topics:410,likes:15200,rep:{forum:1400,market:10,review:80,prediction:68},badges:["Senior moderator"],favTeams:["chiefs"],favSports:["american-football"]}),
  pitchside_hq:  U("pitchside_hq","admin",{joined:ago(2400*DAY),posts:820,topics:95,likes:3000,rep:{forum:400,market:0,review:0,prediction:null},badges:["Admin"]}),
  root_ops:      U("root_ops","super_admin",{joined:ago(2400*DAY),posts:12,topics:1,likes:10,badges:["Super admin"]}),
  gooner_kev:    U("gooner_kev","member",{posts:1500,topics:88,likes:3200,favTeams:["arsenal"],favSports:["football"]}),
  withdrawal_wanda:U("withdrawal_wanda","trusted",{posts:980,rep:{forum:300,market:0,review:120,prediction:null}}),
  xg_merchant:   U("xg_merchant","moderator",{posts:3300,favTeams:["real-madrid"],privacy:{dms:"everyone",showActivity:true}}),
  satoshi_sub:   U("satoshi_sub","moderator",{posts:2100,favSports:["football"]}),
  courtside_kofi:U("courtside_kofi","moderator",{posts:2600,favTeams:["celtics"],favSports:["basketball"]}),
  accra_ultra:   U("accra_ultra","member",{posts:510,favTeams:["hearts-of-oak"]}),
  hodl_hannah:   U("hodl_hannah","member",{posts:330,privacy:{dms:"nobody",showActivity:false}}),
  kitfan99:      U("kitfan99","new_member",{posts:6,joined:ago(9*DAY)})
};
// Which demo account each "View as" option signs in as
const DEMO = {new_member:"rookie_ruth", member:"kwame_fc", trusted:"sharp_sam", verified_reviewer:"verified_vee",
  verified_seller:"kitbag_kojo", business:"stakeline_rep", moderator:"offside_ama", senior_moderator:"lineswoman",
  admin:"pitchside_hq", super_admin:"root_ops"};

/* ---------- Sports entities (sports, leagues, teams, players, events, event_stats) §5 ---------- */
let SPORTS = ["Football","Basketball","American Football","Baseball","Ice Hockey","Tennis","Cricket","Rugby","Motorsport","Combat Sports","Golf","Esports",
  "Athletics","Cycling","Darts","Snooker","Volleyball","Handball","Horse Racing","Greyhound Racing","Other Sports"]
  .map(n => ({slug: n.toLowerCase().replace(/ /g,"-"), name:n, launch:["Football","Basketball","American Football","Baseball","Ice Hockey","Tennis","Cricket","Rugby","Motorsport","Combat Sports"].includes(n)}));

// Leagues and tournaments, grouped by region. Teams belong to one main league and can also play in others (e.g. the Champions League).
const REGIONS = ["International","Europe","North America","South America","Africa","Asia"];
const L = (slug, name, sport, region, country, o={}) => Object.assign({slug, name, sport, region, country, type:"league", season:"2026/27", board:null, logo:null}, o);
let LEAGUES = [
  L("fifa-world-cup","FIFA World Cup","football","International","World",{type:"tournament", season:"2026"}),
  L("atp","ATP Tour","tennis","International","World",{type:"tour", season:"2026", board:"tennis"}),
  L("wta","WTA Tour","tennis","International","World",{type:"tour", season:"2026"}),
  L("ufc","UFC","combat-sports","International","World",{type:"promotion", season:"2026", board:"combat-sports"}),
  L("formula-1","Formula 1","motorsport","International","World",{type:"championship", season:"2026"}),
  L("premier-league","Premier League","football","Europe","England",{board:"premier-league"}),
  L("laliga","LaLiga","football","Europe","Spain"),
  L("serie-a","Serie A","football","Europe","Italy"),
  L("bundesliga","Bundesliga","football","Europe","Germany"),
  L("ligue-1","Ligue 1","football","Europe","France"),
  L("champions-league","UEFA Champions League","football","Europe","Europe",{type:"tournament", board:"champions-league"}),
  L("six-nations","Six Nations","rugby","Europe","Europe",{type:"tournament", season:"2027"}),
  L("nba","NBA","basketball","North America","USA",{board:"nba"}),
  L("nfl","NFL","american-football","North America","USA",{season:"2026", board:"nfl"}),
  L("mlb","MLB","baseball","North America","USA",{season:"2026"}),
  L("nhl","NHL","ice-hockey","North America","USA & Canada"),
  L("mls","MLS","football","North America","USA & Canada",{season:"2026"}),
  L("brasileirao","Brasileirão Série A","football","South America","Brazil",{season:"2026"}),
  L("liga-profesional","Liga Profesional","football","South America","Argentina",{season:"2026"}),
  L("copa-libertadores","Copa Libertadores","football","South America","South America",{type:"tournament", season:"2026"}),
  L("caf-champions-league","CAF Champions League","football","Africa","Africa",{type:"tournament"}),
  L("afcon","Africa Cup of Nations","football","Africa","Africa",{type:"tournament", season:"2027"}),
  L("egyptian-premier-league","Egyptian Premier League","football","Africa","Egypt"),
  L("south-african-premiership","South African Premiership","football","Africa","South Africa"),
  L("npfl","Nigeria Premier Football League","football","Africa","Nigeria"),
  L("ghana-premier-league","Ghana Premier League","football","Africa","Ghana",{board:"ghana-pl"}),
  L("saudi-pro-league","Saudi Pro League","football","Asia","Saudi Arabia"),
  L("j1-league","J1 League","football","Asia","Japan",{season:"2026"}),
  L("k-league-1","K League 1","football","Asia","South Korea",{season:"2026"}),
  L("indian-super-league","Indian Super League","football","Asia","India"),
  L("afc-champions-league","AFC Champions League Elite","football","Asia","Asia",{type:"tournament"}),
  L("ipl","Indian Premier League","cricket","Asia","India",{type:"league", season:"2027"})
];
// Badge colours are placeholders until official logos are uploaded in Admin → Sports.
const TM = (slug, name, short, league, country, color, also=[]) => ({slug, name, short, league, country, color, also, stadium:"", founded:"", logo:null});
let TEAMS = [
  {slug:"arsenal",        name:"Arsenal",          short:"ARS",league:"premier-league",country:"England",stadium:"Emirates Stadium",founded:1886,color:"#C8102E"},
  {slug:"tottenham",      name:"Tottenham Hotspur",short:"TOT",league:"premier-league",country:"England",stadium:"Tottenham Hotspur Stadium",founded:1882,color:"#132257"},
  {slug:"liverpool",      name:"Liverpool",        short:"LIV",league:"premier-league",country:"England",stadium:"Anfield",founded:1892,color:"#A6192E"},
  {slug:"chelsea",        name:"Chelsea",          short:"CHE",league:"premier-league",country:"England",stadium:"Stamford Bridge",founded:1905,color:"#034694"},
  {slug:"manchester-united",name:"Manchester United",short:"MUN",league:"premier-league",country:"England",stadium:"Old Trafford",founded:1878,color:"#DA291C"},
  {slug:"manchester-city",name:"Manchester City",  short:"MCI",league:"premier-league",country:"England",stadium:"Etihad Stadium",founded:1880,color:"#4C8FC9"},
  {slug:"hearts-of-oak",  name:"Accra Hearts of Oak",short:"HOK",league:"ghana-premier-league",country:"Ghana",stadium:"Accra Sports Stadium",founded:1911,color:"#B8002E"},
  {slug:"asante-kotoko",  name:"Asante Kotoko",    short:"KOT",league:"ghana-premier-league",country:"Ghana",stadium:"Baba Yara Stadium",founded:1935,color:"#C9A100"},
  {slug:"medeama",        name:"Medeama",          short:"MED",league:"ghana-premier-league",country:"Ghana",stadium:"Tarkwa Akoon Park",founded:2002,color:"#7A1F5C"},
  {slug:"real-madrid",    name:"Real Madrid",      short:"RMA",league:"laliga",country:"Spain",stadium:"Santiago Bernabéu",founded:1902,color:"#3D4A8C"},
  {slug:"inter",          name:"Inter",            short:"INT",league:"serie-a",country:"Italy",stadium:"San Siro",founded:1908,color:"#0068A8"},
  {slug:"boston-celtics", name:"Boston Celtics",   short:"BOS",league:"nba",country:"USA",stadium:"TD Garden",founded:1946,color:"#007A33"},
  {slug:"new-york-knicks",name:"New York Knicks",  short:"NYK",league:"nba",country:"USA",stadium:"Madison Square Garden",founded:1946,color:"#D2611E"},
  {slug:"kansas-city-chiefs",name:"Kansas City Chiefs",short:"KC",league:"nfl",country:"USA",stadium:"Arrowhead Stadium",founded:1960,color:"#C8102E"},
  {slug:"buffalo-bills",  name:"Buffalo Bills",    short:"BUF",league:"nfl",country:"USA",stadium:"Highmark Stadium",founded:1960,color:"#00338D"},
  TM("barcelona","FC Barcelona","BAR","laliga","Spain","#A50044",["champions-league"]), TM("atletico-madrid","Atlético Madrid","ATM","laliga","Spain","#CB3524",["champions-league"]), TM("sevilla","Sevilla","SEV","laliga","Spain","#D4021D"),
  TM("ac-milan","AC Milan","MIL","serie-a","Italy","#C8102E",["champions-league"]), TM("juventus","Juventus","JUV","serie-a","Italy","#111111",["champions-league"]), TM("napoli","Napoli","NAP","serie-a","Italy","#12A0D7"),
  TM("bayern-munich","Bayern Munich","FCB","bundesliga","Germany","#DC052D",["champions-league"]), TM("borussia-dortmund","Borussia Dortmund","BVB","bundesliga","Germany","#2B2B2B",["champions-league"]), TM("bayer-leverkusen","Bayer Leverkusen","B04","bundesliga","Germany","#E32221",["champions-league"]), TM("rb-leipzig","RB Leipzig","RBL","bundesliga","Germany","#DD0741"),
  TM("psg","Paris Saint-Germain","PSG","ligue-1","France","#004170",["champions-league"]), TM("marseille","Olympique de Marseille","OM","ligue-1","France","#2FAEE0"), TM("lyon","Olympique Lyonnais","OL","ligue-1","France","#1C3F94"), TM("monaco","AS Monaco","ASM","ligue-1","France","#E51B22",["champions-league"]),
  TM("brazil","Brazil","BRA","fifa-world-cup","Brazil","#009C3B"), TM("argentina","Argentina","ARG","fifa-world-cup","Argentina","#5B9BD5"), TM("france","France","FRA","fifa-world-cup","France","#002395"), TM("england","England","ENG","fifa-world-cup","England","#CE1124"), TM("usa","United States","USA","fifa-world-cup","USA","#0A3161"), TM("morocco","Morocco","MAR","fifa-world-cup","Morocco","#C1272D",["afcon"]),
  TM("los-angeles-lakers","Los Angeles Lakers","LAL","nba","USA","#552583"), TM("golden-state-warriors","Golden State Warriors","GSW","nba","USA","#1D428A"),
  TM("dallas-cowboys","Dallas Cowboys","DAL","nfl","USA","#041E42"), TM("philadelphia-eagles","Philadelphia Eagles","PHI","nfl","USA","#004C54"),
  TM("new-york-yankees","New York Yankees","NYY","mlb","USA","#0C2340"), TM("los-angeles-dodgers","Los Angeles Dodgers","LAD","mlb","USA","#005A9C"), TM("boston-red-sox","Boston Red Sox","BOS","mlb","USA","#BD3039"), TM("chicago-cubs","Chicago Cubs","CHC","mlb","USA","#0E3386"),
  TM("toronto-maple-leafs","Toronto Maple Leafs","TOR","nhl","Canada","#00205B"), TM("new-york-rangers","New York Rangers","NYR","nhl","USA","#0038A8"), TM("boston-bruins","Boston Bruins","BOS","nhl","USA","#5C4A00"), TM("edmonton-oilers","Edmonton Oilers","EDM","nhl","Canada","#041E42"),
  TM("inter-miami","Inter Miami","MIA","mls","USA","#C2185B"), TM("la-galaxy","LA Galaxy","LAG","mls","USA","#00245D"), TM("lafc","Los Angeles FC","LAFC","mls","USA","#2B2B2B"), TM("seattle-sounders","Seattle Sounders","SEA","mls","USA","#5D9741"),
  TM("flamengo","Flamengo","FLA","brasileirao","Brazil","#C52613",["copa-libertadores"]), TM("palmeiras","Palmeiras","PAL","brasileirao","Brazil","#006437",["copa-libertadores"]), TM("corinthians","Corinthians","COR","brasileirao","Brazil","#111111"), TM("sao-paulo","São Paulo","SAO","brasileirao","Brazil","#D80000",["copa-libertadores"]),
  TM("boca-juniors","Boca Juniors","BOC","liga-profesional","Argentina","#103F79",["copa-libertadores"]), TM("river-plate","River Plate","RIV","liga-profesional","Argentina","#E30613",["copa-libertadores"]), TM("racing-club","Racing Club","RAC","liga-profesional","Argentina","#3A7BBF"), TM("independiente","Independiente","IND","liga-profesional","Argentina","#E2001A"),
  TM("al-ahly","Al Ahly","AHL","egyptian-premier-league","Egypt","#C8102E",["caf-champions-league"]), TM("zamalek","Zamalek","ZAM","egyptian-premier-league","Egypt","#9E1B32",["caf-champions-league"]), TM("pyramids","Pyramids FC","PYR","egyptian-premier-league","Egypt","#1C2A5C",["caf-champions-league"]),
  TM("mamelodi-sundowns","Mamelodi Sundowns","SUN","south-african-premiership","South Africa","#B38F00",["caf-champions-league"]), TM("kaizer-chiefs","Kaizer Chiefs","KZC","south-african-premiership","South Africa","#B8860B"), TM("orlando-pirates","Orlando Pirates","ORL","south-african-premiership","South Africa","#111111",["caf-champions-league"]),
  TM("enyimba","Enyimba","ENY","npfl","Nigeria","#0A5C36"), TM("rangers-international","Rangers International","RAN","npfl","Nigeria","#D10A11"),
  TM("nigeria","Nigeria","NGA","afcon","Nigeria","#008751"), TM("egypt","Egypt","EGY","afcon","Egypt","#C8102E"), TM("senegal","Senegal","SEN","afcon","Senegal","#00853F"), TM("ghana","Ghana","GHA","afcon","Ghana","#006B3F"),
  TM("al-hilal","Al Hilal","HIL","saudi-pro-league","Saudi Arabia","#0F3D8C",["afc-champions-league"]), TM("al-nassr","Al Nassr","NAS","saudi-pro-league","Saudi Arabia","#B8860B",["afc-champions-league"]), TM("al-ittihad","Al Ittihad","ITT","saudi-pro-league","Saudi Arabia","#2B2B2B"),
  TM("kashima-antlers","Kashima Antlers","KAS","j1-league","Japan","#B71C1C"), TM("urawa-reds","Urawa Red Diamonds","URA","j1-league","Japan","#E60012",["afc-champions-league"]), TM("vissel-kobe","Vissel Kobe","VIS","j1-league","Japan","#8B0029",["afc-champions-league"]),
  TM("ulsan-hd","Ulsan HD","ULS","k-league-1","South Korea","#004B9C",["afc-champions-league"]), TM("jeonbuk-motors","Jeonbuk Hyundai Motors","JEO","k-league-1","South Korea","#0B6E3A"),
  TM("mohun-bagan","Mohun Bagan Super Giant","MBSG","indian-super-league","India","#8B1C3E"), TM("kerala-blasters","Kerala Blasters","KBFC","indian-super-league","India","#B8860B"),
  TM("mumbai-indians","Mumbai Indians","MI","ipl","India","#004BA0"), TM("chennai-super-kings","Chennai Super Kings","CSK","ipl","India","#B8860B"), TM("royal-challengers-bengaluru","Royal Challengers Bengaluru","RCB","ipl","India","#D71920"), TM("kolkata-knight-riders","Kolkata Knight Riders","KKR","ipl","India","#3A225D"),
  TM("ferrari","Scuderia Ferrari","FER","formula-1","Italy","#DC0000"), TM("red-bull-racing","Red Bull Racing","RBR","formula-1","Austria","#1E41FF"), TM("mclaren","McLaren","MCL","formula-1","England","#E07000"), TM("mercedes","Mercedes-AMG","MER","formula-1","Germany","#00877C")
];
// Existing clubs that also play in the Champions League
["arsenal","liverpool","manchester-city","chelsea","real-madrid","inter"].forEach(s => { const t = TEAMS.find(x => x.slug === s); t.also = t.also || []; if (!t.also.includes("champions-league")) t.also.push("champions-league"); });
TEAMS.forEach(t => { t.also = t.also || []; t.logo = t.logo || null; });
const teamsIn = slug => TEAMS.filter(t => t.league === slug || (t.also || []).includes(slug));
const PLAYERS = [
  {slug:"b-saka", name:"B. Saka", team:"arsenal", pos:"RW"}, {slug:"m-odegaard", name:"M. Ødegaard", team:"arsenal", pos:"AM"},
  {slug:"j-maddison", name:"J. Maddison", team:"tottenham", pos:"AM"}
];
// Standings: [team, P, W, D, L, GF, GA]
const STANDINGS = {
  "premier-league":[["arsenal",7,5,1,1,14,6],["liverpool",7,5,1,1,16,8],["manchester-city",7,4,2,1,15,7],["chelsea",7,4,1,2,12,9],["tottenham",7,3,1,3,11,11],["manchester-united",7,2,2,3,8,10]],
  "ghana-premier-league":[["asante-kotoko",5,3,2,0,8,3],["hearts-of-oak",5,3,1,1,7,4],["medeama",5,2,1,2,5,6]],
  "nba":[["boston-celtics",0,0,0,0,0,0],["new-york-knicks",0,0,0,0,0,0]],
  "nfl":[["buffalo-bills",4,3,0,1,104,80],["kansas-city-chiefs",4,3,0,1,98,77]],
  "champions-league":[["real-madrid",2,1,1,0,3,1],["inter",2,1,1,0,2,1]]
};
let EVENTS = [
  {slug:"arsenal-vs-tottenham", league:"premier-league", home:"arsenal", away:"tottenham", at:ago(3*HR), status:"finished", score:[2,1],
   stats:{Possession:[58,42],Shots:[16,9],"On target":[7,3],Corners:[6,2]}, lineups:{home:["Raya","White","Saliba","Gabriel","Calafiori","Rice","Ødegaard","Merino","Saka","Havertz","Martinelli"],away:["Vicario","Porro","Romero","Van de Ven","Udogie","Bissouma","Maddison","Kulusevski","Johnson","Solanke","Son"]}, thread:1},
  {slug:"barcelona-vs-real-madrid", league:"laliga", home:"barcelona", away:"real-madrid", at:ago(67*MIN), status:"live", minute:"67'", score:[1,1],
   stats:{Possession:[51,49],Shots:[8,7],"On target":[3,2],Corners:[4,3]}, lineups:null, thread:6},
  {slug:"real-madrid-vs-inter", league:"champions-league", home:"real-madrid", away:"inter", at:ago(23*MIN), status:"live", minute:"23'", score:[0,0], stats:{Possession:[55,45],Shots:[3,2]}, lineups:null, thread:null},
  {slug:"kansas-city-chiefs-vs-buffalo-bills", league:"nfl", home:"kansas-city-chiefs", away:"buffalo-bills", at:ago(100*MIN), status:"live", minute:"Q3", score:[17,20], stats:{"Total yards":[288,301],Turnovers:[1,0]}, lineups:null, thread:8},
  {slug:"boston-celtics-vs-new-york-knicks", league:"nba", home:"boston-celtics", away:"new-york-knicks", at:NOW+5*HR, status:"upcoming", score:null, stats:{}, lineups:null, thread:5},
  {slug:"liverpool-vs-chelsea", league:"premier-league", home:"liverpool", away:"chelsea", at:ago(26*HR), status:"finished", score:[3,0], stats:{Possession:[61,39],Shots:[19,6]}, lineups:null, thread:null},
  {slug:"manchester-united-vs-manchester-city", league:"premier-league", home:"manchester-united", away:"manchester-city", at:NOW+2*DAY, status:"upcoming", score:null, stats:{}, lineups:null, thread:null},
  {slug:"arsenal-vs-liverpool", league:"premier-league", home:"arsenal", away:"liverpool", at:NOW+9*DAY, status:"upcoming", score:null, stats:{}, lineups:null, thread:null},
  {slug:"medeama-vs-hearts-of-oak", league:"ghana-premier-league", home:"medeama", away:"hearts-of-oak", at:NOW+4*DAY, status:"upcoming", score:null, stats:{}, lineups:null, thread:null}
];
// Predictions (§28): eventSlug -> {user: "H"|"D"|"A"}. No money involved in V1.
const PREDICTIONS = {
  "arsenal-vs-liverpool":{gooner_kev:"H",offside_ama:"A",sharp_sam:"D",accra_ultra:"H"},
  "boston-celtics-vs-new-york-knicks":{sharp_sam:"H",courtside_kofi:"H",kwame_fc:"A"},
  "medeama-vs-hearts-of-oak":{accra_ultra:"A",offside_ama:"A"},
  "manchester-united-vs-manchester-city":{kwame_fc:"A",gooner_kev:"A",lineswoman:"D"}
};
const PRED_RECORD = {sharp_sam:[41,57],kwame_fc:[33,54],offside_ama:[29,53],gooner_kev:[30,61],courtside_kofi:[22,35],accra_ultra:[18,40]};

/* ---------- Forum hierarchy: Category → Board → Sub-board (§4) ---------- */
const ALL_POSTERS = ["new_member","member","trusted","verified_reviewer","verified_seller","business","moderator","senior_moderator","admin","super_admin"];
const STAFF = ["moderator","senior_moderator","admin","super_admin"];
const B = (slug,name,desc,cat,o={}) => Object.assign({slug,name,desc,cat,parent:null,icon:name[0],mods:[],
  readRoles:ROLES.map(r=>r.id), postRoles:ALL_POSTERS.slice(), order:0}, o);
let CATEGORIES = [
  {id:"sports",   name:"Sports",     order:1},
  {id:"gambling", name:"Gambling",   order:2, gated:true},
  {id:"crypto",   name:"Crypto",     order:4},
  {id:"market",   name:"Marketplace", order:5},
  {id:"community",name:"Community",  order:6}
];
let BOARDS = [
  B("football","Football","Every league, every argument","sports",{mods:["offside_ama"],order:1}),
  B("premier-league","Premier League","Match threads, transfers, VAR rage","sports",{parent:"football",mods:["offside_ama"],order:1}),
  B("champions-league","Champions League","Europe's big nights","sports",{parent:"football",mods:["xg_merchant"],order:2}),
  B("ghana-pl","Ghana Premier League","Hearts, Kotoko and the rest","sports",{parent:"football",mods:["offside_ama"],order:3}),
  B("basketball","Basketball","Hoops talk","sports",{mods:["courtside_kofi"],order:2}),
  B("nba","NBA","Box scores and bad trades","sports",{parent:"basketball",mods:["courtside_kofi"],order:1}),
  B("nfl","NFL","Sundays, fantasy, injury reports","sports",{mods:["lineswoman"],order:3}),
  B("tennis","Tennis","ATP, WTA, Slams","sports",{order:4}),
  B("combat-sports","Combat Sports","UFC, boxing, MMA","sports",{order:5}),
  // ---- Gambling discussion sections (modelled on the big gambling forums: by game, by format, by topic) ----
  B("sports-betting","Sports Betting","Lines, value, tips and bankroll talk for every sport","gambling",{mods:["lineswoman"],order:1}),
  B("football-betting","Football Betting","Premier League, LaLiga, Champions League and the rest","gambling",{parent:"sports-betting",order:1}),
  B("basketball-betting","Basketball Betting","NBA, EuroLeague, college","gambling",{parent:"sports-betting",order:2}),
  B("tennis-betting","Tennis Betting","Slams, ATP, WTA, in-play","gambling",{parent:"sports-betting",order:3}),
  B("nfl-betting","NFL & College Football Betting","Spreads, totals, player props","gambling",{parent:"sports-betting",order:4}),
  B("combat-betting","Boxing & MMA Betting","Fight picks and method-of-victory bets","gambling",{parent:"sports-betting",order:5}),
  B("esports-betting","Esports Betting","CS2, Dota 2, League of Legends, Valorant","gambling",{parent:"sports-betting",order:6}),
  B("live-betting","In-Play & Live Betting","Betting while the game is on","gambling",{parent:"sports-betting",order:7}),
  B("accas","Accas, Bet Builders & Props","Accumulators, same-game multis and player props","gambling",{parent:"sports-betting",order:8}),
  B("picks","Picks & Predictions","Share your picks with reasoning. Track records welcome.","gambling",{parent:"sports-betting",order:9}),
  B("racing","Horse & Greyhound Racing","Form, tips, each-way and racecards","gambling",{order:2}),
  B("casino","Casino","Online and land-based casino talk","gambling",{order:3}),
  B("slots","Slots","Providers, RTP, volatility, bonus buys","gambling",{parent:"casino",order:1}),
  B("live-casino","Live Casino & Game Shows","Live dealers, game shows, crash games","gambling",{parent:"casino",order:2}),
  B("blackjack","Blackjack","Basic strategy, side bets, counting","gambling",{parent:"casino",order:3}),
  B("roulette","Roulette","European, American, lightning roulette","gambling",{parent:"casino",order:4}),
  B("table-games","Baccarat & Other Table Games","Baccarat, craps, sic bo, casino hold'em","gambling",{parent:"casino",order:5}),
  B("land-casinos","Land-based Casinos & Travel","Vegas, Macau, local casinos and trips","gambling",{parent:"casino",order:6}),
  B("poker","Poker","Online and live poker","gambling",{order:4}),
  B("poker-cash","Cash Games","No-limit hold'em, PLO, stakes and game selection","gambling",{parent:"poker",order:1}),
  B("poker-mtt","Tournaments & Sit & Gos","MTTs, satellites, series and ICM","gambling",{parent:"poker",order:2}),
  B("poker-live","Live Poker","Card rooms, home games and live series","gambling",{parent:"poker",order:3}),
  B("poker-strategy","Hand Reviews & Strategy","Post a hand, get feedback","gambling",{parent:"poker",order:4}),
  B("poker-sites","Poker Sites & Apps","Traffic, rakeback, software","gambling",{parent:"poker",order:5}),
  B("sportsbooks","Sportsbooks & Bookmakers","Withdrawals, limits, KYC and account issues","gambling",{mods:["lineswoman"],order:5}),
  B("bonuses","Bonuses & Promotions","Welcome offers, free bets, free spins and reloads. Read the terms.","gambling",{order:6}),
  B("casino-bonuses","Casino Bonuses","Wagering, max-bet rules, free spins","gambling",{parent:"bonuses",order:1}),
  B("free-bets","Free Bets & Sportsbook Promos","Bet credits, boosts, refunds","gambling",{parent:"bonuses",order:2}),
  B("exchanges","Betting Exchanges & Prediction Markets","Laying, trading and event markets","gambling",{order:7}),
  B("fantasy","Fantasy Sports & DFS","Season-long fantasy, daily fantasy and pick'em","gambling",{order:8}),
  B("lottery-bingo","Lottery, Bingo & Scratchcards","National lotteries, online bingo, instant wins","gambling",{order:9}),
  B("sweepstakes","Sweepstakes & Social Casinos","Free-to-play and sweepstakes sites","gambling",{order:10}),
  B("gambling-strategy","Gambling Strategy & Maths","Odds, staking, variance and bankroll management","gambling",{order:11}),
  B("matched-betting","Matched Betting & Arbitrage","Bonus extraction, arbs and the account limits that follow","gambling",{parent:"gambling-strategy",order:1}),
  B("bankroll","Bankroll Management","Staking plans, record keeping, tilt","gambling",{parent:"gambling-strategy",order:2}),
  B("gambling-news","Gambling News & Regulation","Licensing, new laws, country-by-country rules","gambling",{order:12}),
  B("scam-accusations","Scam Accusations","Structured reports. Evidence required.","gambling",{mods:["lineswoman"],order:13,postRoles:["member","trusted","verified_reviewer","verified_seller","business","moderator","senior_moderator","admin","super_admin"]}),
  B("wins-losses","Big Wins & Bad Beats","Share the highs and the lows","gambling",{order:14}),
  B("responsible-gambling","Responsible Gambling","Limits, breaks, self-exclusion and getting help","gambling",{order:15}),
  // One topic per complaint, created automatically. Members reply; only staff start topics here.
  B("complaint-talk","Complaint Discussions","Members discuss player complaints. Not part of the official case.","gambling",{order:16, postRoles:["moderator","senior_moderator","admin","super_admin"], replyRoles:ALL_POSTERS.slice()}),
  // Crypto: one board per major coin (top ten by market cap; check the list before launch), stablecoins grouped.
  B("bitcoin","Bitcoin","BTC: wallets, self-custody, Lightning and paying with bitcoin","crypto",{mods:["satoshi_sub"],order:1, coin:"BTC"}),
  B("ethereum","Ethereum","ETH: gas, layer 2s, staking and wallets","crypto",{mods:["satoshi_sub"],order:2, coin:"ETH"}),
  B("stablecoins","Stablecoins","Dollar-pegged coins for payments, payouts and escrow","crypto",{mods:["satoshi_sub"],order:3, coin:"USD"}),
  B("tether","Tether (USDT)","USDT on TRON, Ethereum and other networks","crypto",{parent:"stablecoins",order:1, coin:"USDT"}),
  B("usdc","USD Coin (USDC)","USDC on Ethereum, Base, Solana and others","crypto",{parent:"stablecoins",order:2, coin:"USDC"}),
  B("xrp","XRP","XRP Ledger, transfers and remittances","crypto",{order:4, coin:"XRP"}),
  B("bnb","BNB","BNB Chain, fees and wallets","crypto",{order:5, coin:"BNB"}),
  B("solana","Solana","SOL: wallets, fees and apps","crypto",{order:6, coin:"SOL"}),
  B("dogecoin","Dogecoin","DOGE talk, tipping and spending","crypto",{order:7, coin:"DOGE"}),
  B("tron","TRON","TRX and the TRON network","crypto",{order:8, coin:"TRX"}),
  B("cardano","Cardano","ADA: staking, wallets and the ecosystem","crypto",{order:9, coin:"ADA"}),
  B("altcoins","Other Altcoins & Fan Tokens","Everything else, including club fan tokens","crypto",{mods:["satoshi_sub"],order:10}),
  B("crypto-gambling","Crypto Gambling","Crypto casinos and books","crypto",{mods:["satoshi_sub"],order:11}),
  // Reviews: every review is a topic. Starting a topic here opens the review form.
  B("sportsbook-reviews","Sportsbook Reviews","One topic per review. Rate a sportsbook and discuss it.","gambling",{order:21, kind:"review", opType:"sportsbook"}),
  B("casino-reviews","Casino Reviews","One topic per review. Rate a casino and discuss it.","gambling",{order:20, kind:"review", opType:"casino"}),
  // Marketplace: every listing is a topic. Starting a topic here opens the listing form.
  B("buy-sell","Items & Tickets","Memorabilia, kit, tickets and other things","market",{order:1, kind:"listing", mcat:"Items & tickets"}),
  B("collectibles","Sports Products & Collectibles","Kits, signed memorabilia, equipment","market",{parent:"buy-sell", order:1, kind:"listing", mcat:"Sports products & collectibles"}),
  B("tickets","Tickets","Face value only","market",{parent:"buy-sell", order:2, kind:"listing", mcat:"Tickets"}),
  B("services","Services","Offer or request services","market",{order:2, kind:"listing", mcat:"Services"}),
  B("design","Design","Logos, graphics, video","market",{parent:"services", order:1, kind:"listing", mcat:"Design"}),
  B("development","Development","Sites, apps, spreadsheets, bots","market",{parent:"services", order:2, kind:"listing", mcat:"Development"}),
  B("marketing","Marketing","Social, SEO, content","market",{parent:"services", order:3, kind:"listing", mcat:"Marketing"}),
  B("advertising","Advertising","Ad space and sponsorships","market",{parent:"services", order:4, kind:"listing", mcat:"Advertising"}),
  B("digital","Websites, Domains & Software","Digital assets","market",{order:3, kind:"listing", mcat:"Software"}),
  B("websites","Websites","Sites for sale","market",{parent:"digital", order:1, kind:"listing", mcat:"Websites"}),
  B("domains","Domains","Domain names","market",{parent:"digital", order:2, kind:"listing", mcat:"Domains"}),
  B("software","Software","Tools and licences","market",{parent:"digital", order:3, kind:"listing", mcat:"Software"}),
  B("crypto-market","Crypto Trades","Buy and sell crypto person to person","market",{order:4, kind:"listing", mcat:"Crypto"}),
  B("jobs","Jobs","Hiring and looking for work","market",{order:5, kind:"listing", mcat:"Jobs offered"}),
  B("jobs-offered","Jobs Offered","Paid work on offer","market",{parent:"jobs", order:1, kind:"listing", mcat:"Jobs offered"}),
  B("jobs-wanted","Jobs Wanted","Members looking for work","market",{parent:"jobs", order:2, kind:"listing", mcat:"Jobs wanted"}),
  B("freelancers","Freelancers","Freelancer profiles and offers","market",{parent:"jobs", order:3, kind:"listing", mcat:"Freelancers"}),
  B("hiring","Companies Hiring","Company job posts","market",{parent:"jobs", order:4, kind:"listing", mcat:"Companies hiring"}),
  B("marketplace-talk","Marketplace Talk","Questions about trading on Pitchside","market",{order:6}),
  B("general","General Discussion","Anything sport-adjacent","community",{order:1}),
  B("help","Help & Feedback","How the site works","community",{order:2}),
  B("off-topic","Off-topic","Not sport. Still civil.","community",{order:3}),
  B("announcements","Announcements","News from the Pitchside team","community",{order:0,postRoles:["admin","super_admin"]})
];
// Every league gets a forum board under its sport's board, created automatically.
const SPORT_BOARD = {football:"football", basketball:"basketball", "american-football":"nfl", tennis:"tennis", "combat-sports":"combat-sports"};
function ensureLeagueBoard(l){
  let parent = SPORT_BOARD[l.sport];
  if (!parent){ const sp = SPORTS.find(x => x.slug === l.sport); parent = l.sport;
    if (!BOARDS.some(b => b.slug === parent)) BOARDS.push(B(parent, sp ? sp.name : l.sport, `${sp ? sp.name : l.sport} talk`, "sports", {order:10 + BOARDS.filter(b=>b.cat==="sports"&&!b.parent).length}));
    SPORT_BOARD[l.sport] = parent; }
  if (!l.board){ l.board = BOARDS.some(b => b.slug === l.slug) ? l.slug + "-talk" : l.slug;
    BOARDS.push(B(l.board, l.name, `${l.name} discussion`, "sports", {parent: parent === l.board ? null : parent, order:20 + BOARDS.length})); }
}
LEAGUES.forEach(ensureLeagueBoard);


/* ---------- Topics & posts (topics, posts, post_revisions, tags, topic_tags) ---------- */
let TAGS = [
  {slug:"match-thread",name:"Match thread",desc:"Auto-created threads for events",index:true},
  {slug:"transfers",name:"Transfers",desc:"Transfer rumours and done deals",index:true},
  {slug:"predictions",name:"Predictions",desc:"Who wins and why",index:true},
  {slug:"betting",name:"Betting",desc:"Lines, odds and bets",index:true},
  {slug:"withdrawals",name:"Withdrawals",desc:"Payout experiences",index:true},
  {slug:"fan-talk",name:"Fan talk",desc:"Supporters' discussion",index:false},
  {slug:"fan-tokens",name:"Fan tokens",desc:"Club tokens and crypto",index:false}
];
let topicSeq = 100, postSeq = 1000;
const P = (author, body, at, o={}) => Object.assign({id:++postSeq, author, body, at, likes:new Set(), revisions:[], hidden:false}, o);
const T = (id, board, title, author, at, posts, o={}) => Object.assign({id, board, title, author, at, posts,
  pinned:false, locked:false, archived:false, tags:[], teams:[], league:null, event:null, views:0, poll:null}, o);

const filler = ["Back four looked shaky again in the second half.","That substitution changed everything.","Referee lost control after the hour mark.",
 "xG says we deserved more than that.","Midfield press was the difference.","I'll take three points, ugly or not.","Best atmosphere I've heard all season.",
 "Squad depth is going to matter in December.","Their keeper kept them in it.","We need a proper striker in January.","Set pieces won this.",
 "Tactically the coach got it spot on.","Can't believe that wasn't a penalty.","Fitness levels looked way better this week."];
const crowd = ["gooner_kev","kwame_fc","accra_ultra","sharp_sam","offside_ama","xg_merchant","withdrawal_wanda","verified_vee"];
const matchPosts = [P("offside_ama","Auto-created match thread. Keep it civil, keep it about the game.\n\nArsenal 2–1 Tottenham · Premier League · Emirates Stadium", ago(5*HR))];
for (let i=0;i<23;i++) matchPosts.push(P(crowd[i%crowd.length], filler[i%filler.length], ago(5*HR - (i+1)*9*MIN)));
matchPosts[3].likes = new Set(["kwame_fc","sharp_sam","accra_ultra"]);
matchPosts[5].body = "[quote=offside_ama]Keep it civil, keep it about the game.[/quote]Fair, but @gooner_kev owes me a drink after that finish.";
matchPosts[5].author = "kwame_fc";
matchPosts[5].revisions = [{at:ago(4*HR),body:"Fair, but gooner_kev owes me a drink.",by:"kwame_fc"}];

let TOPICS = [
  T(1,"premier-league","Arsenal 2–1 Tottenham: match thread","offside_ama",ago(5*HR),matchPosts,{pinned:true,tags:["match-thread"],teams:["arsenal","tottenham"],league:"premier-league",event:"arsenal-vs-tottenham",views:18420,auto:true}),
  T(2,"sportsbooks","Which books actually pay out same-day? Logging my withdrawals","withdrawal_wanda",ago(2*HR),[
    P("withdrawal_wanda","Six weeks of withdrawals, all crypto. Stakeline: avg 3h. NorthPeak: 2 days, asked for KYC on the third withdrawal. Golden Reel: still waiting on one from last week.",ago(2*HR)),
    P("sharp_sam","Same with NorthPeak. KYC isn't the problem, asking for it only after you win is.",ago(110*MIN)),
    P("stakeline_rep","Official Stakeline account here. Crypto payouts are automated under 0.5 BTC equivalent. Anything above goes to a manual check. Happy to look at any stuck case if you DM me the ID.",ago(90*MIN)),
    P("verified_vee","Golden Reel paid me eventually but it took 9 days. Filed a complaint, see PC-1043.",ago(70*MIN))
  ],{tags:["withdrawals"],views:4120}),
  T(3,"champions-league","Is a back three the answer for Madrid in the knockouts?","xg_merchant",ago(3*HR),[
    P("xg_merchant","Their full-backs keep getting isolated. A back three gives cover without losing the press. Thoughts?",ago(3*HR)),
    P("gooner_kev","Only works if the wing-backs can actually defend.",ago(150*MIN))
  ],{teams:["real-madrid"],league:"champions-league",views:2210}),
  T(4,"altcoins","Fan tokens after the season opener: who held value?","satoshi_sub",ago(4*HR),[
    P("satoshi_sub","Tracking the big club tokens since August. Most bled 20–40%. Disclosure: I hold none of them right now.",ago(4*HR)),
    P("hodl_hannah","Utility is still the problem. Voting on a goal song isn't a business model.",ago(3*HR))
  ],{tags:["fan-tokens"],views:1630}),
  T(5,"nba","Celtics vs Knicks preview: −4.5 feels wrong","courtside_kofi",ago(5*HR),[
    P("courtside_kofi","Knicks rest disadvantage is overstated. I'd take the points. Poll below.",ago(5*HR))
  ],{tags:["betting","predictions"],teams:["boston-celtics","new-york-knicks"],league:"nba",event:"boston-celtics-vs-new-york-knicks",views:1980,
     poll:{q:"Who covers −4.5?",multi:false,closes:NOW+5*HR,publicResults:true,options:[{t:"Celtics",v:new Set(["sharp_sam","gooner_kev"])},{t:"Knicks",v:new Set(["courtside_kofi","kwame_fc","accra_ultra"])}]}}),
  T(6,"laliga","Barcelona vs Real Madrid: live match thread","offside_ama",ago(80*MIN),[
    P("offside_ama","Auto-created match thread. El Clásico. 1–1 at the moment.",ago(80*MIN)),
    P("accra_ultra","That equaliser was coming. Madrid have been camped in their own box for 20 minutes.",ago(30*MIN)),
    P("rookie_ruth","First derby I'm watching with you lot. Stadium looks packed!",ago(20*MIN))
  ],{pinned:true,tags:["match-thread"],teams:["barcelona","real-madrid"],league:"laliga",event:"barcelona-vs-real-madrid",views:6550,auto:true}),
  T(7,"marketplace-talk","How do I check someone before I pay for a signed kit?","kitfan99",ago(7*HR),[
    P("kitfan99","Seen a few signed shirts on the marketplace. What should I ask for?",ago(7*HR)),
    P("kitbag_kojo","Ask for a certificate with a serial and a photo of the signing if they have it. And check marketplace feedback, not forum rep.",ago(6*HR))
  ],{views:410}),
  T(8,"nfl","Week 5 injury report megathread","lineswoman",ago(9*HR),[
    P("lineswoman","One thread for all Week 5 injury news. Link sources.",ago(9*HR))
  ],{locked:true,teams:["kansas-city-chiefs","buffalo-bills"],league:"nfl",views:3900}),
  T(9,"premier-league","January window: who are Arsenal actually buying?","gooner_kev",ago(26*HR),[
    P("gooner_kev","Need a striker. Every January we say this.",ago(26*HR)),
    P("kwame_fc","A proper No. 9 and a backup left-back. That's it.",ago(25*HR))
  ],{tags:["transfers"],teams:["arsenal"],league:"premier-league",views:2600}),
  T(10,"premier-league","Arsenal vs Liverpool predictions","kwame_fc",ago(30*HR),[
    P("kwame_fc","Top of the table clash next week. Make your call on the event page and argue it here.",ago(30*HR))
  ],{tags:["predictions","betting"],teams:["arsenal","liverpool"],league:"premier-league",event:"arsenal-vs-liverpool",views:1200}),
  T(11,"announcements","Welcome to Pitchside Forum: rules and how moderation works","pitchside_hq",ago(60*DAY),[
    P("pitchside_hq","Read the rules. Report, don't retaliate. Every moderation action is logged and appealable.",ago(60*DAY))
  ],{pinned:true,locked:true,views:22000}),
  T(12,"responsible-gambling","Setting deposit limits on every book: a checklist","sharp_sam",ago(3*DAY),[
    P("sharp_sam","Every book I use has deposit limits buried in settings. Here's where to find them.",ago(3*DAY))
  ],{pinned:true,views:5100}),
  T(13,"ghana-pl","Kotoko need a new left-back","accra_ultra",ago(2*DAY),[P("accra_ultra","Not my club but it's obvious.",ago(2*DAY))],{tags:["transfers"],teams:["asante-kotoko"],league:"ghana-premier-league"}),
  T(14,"scam-accusations","[Allegation] LuckyAtlas confiscating winnings after bonus wager","verified_vee",ago(5*DAY),[
    P("verified_vee","Structured report. Evidence attached on complaint PC-1045. This is an allegation, not a finding.",ago(5*DAY))
  ],{views:3300}),
  T(15,"sports-betting","Weekend value: Inter vs Juventus, under 2.5 at 1.85?","lineswoman",ago(6*HR),[
    P("lineswoman","Last five meetings: four went under. Both sides missing their main striker. I think 1.85 is generous.",ago(6*HR)),
    P("sharp_sam","Agree on the under. Small stakes though, derby referees give soft penalties.",ago(5*HR))
  ],{tags:["betting"],views:940}),
  T(16,"casino","Live blackjack: which tables actually let you sit at low stakes?","gooner_kev",ago(1*DAY),[
    P("gooner_kev","Every live table I find is $25 minimum by evening. Anyone found decent $1–$5 tables that aren't always full?",ago(1*DAY)),
    P("accra_ultra","Blue Harbor has a few $2 tables in the morning, GMT. Gone by 6pm.",ago(20*HR))
  ],{views:410}),
  T(17,"gambling-strategy","Flat staking vs Kelly for a small bankroll","xg_merchant",ago(3*DAY),[
    P("xg_merchant","Bankroll of $200. Half-Kelly swings too much for me. Is flat 1% just better when your edge estimates are noisy?",ago(3*DAY)),
    P("lineswoman","If you can't trust your edge, flat staking is the honest option. Kelly assumes you know your edge.",ago(2*DAY))
  ],{tags:["betting"],views:780})
  ,
  // ---- Crypto sample threads ----
  T(18,"bitcoin","Hardware wallet or phone wallet for your first bitcoin?","hodl_hannah",ago(7*HR),[
    P("hodl_hannah","Bought my first small amount after payday. Exchange app, phone wallet or straight to a hardware wallet? Amount is small for now.",ago(7*HR)),
    P("satoshi_sub","For small amounts a reputable phone wallet is fine. Write the seed phrase on paper, never in a screenshot. Move to hardware once it's money you'd hate to lose.",ago(6*HR)),
    P("kwame_fc","Whatever you pick, send a tiny test amount first. Learned that one the hard way.",ago(5*HR))
  ],{views:1210}),
  T(19,"bitcoin","Has anyone paid for match tickets in BTC?","gooner_kev",ago(2*DAY),[
    P("gooner_kev","Seller in the marketplace takes BTC. Fees for a $60 ticket seem silly on-chain. Is Lightning the answer?",ago(2*DAY)),
    P("sharp_sam","Lightning, yes, if they have a Lightning wallet. Otherwise ask if they'll take USDT and use escrow instead.",ago(2*DAY-3*HR))
  ],{views:640}),
  T(20,"ethereum","Layer 2 or mainnet for small transfers?","xg_merchant",ago(10*HR),[
    P("xg_merchant","Sending $30 to a mate. Mainnet gas is more than I'd like. Arbitrum, Base or Optimism, any real difference for a beginner?",ago(10*HR)),
    P("hodl_hannah","For small stuff any of the big L2s is fine. Check the receiver's wallet supports the same network or the money looks 'missing'.",ago(9*HR))
  ],{views:890}),
  T(21,"ethereum","Staking ETH: solo, pool or exchange?","satoshi_sub",ago(4*DAY),[
    P("satoshi_sub","Summary thread. Solo staking needs 32 ETH and a machine. Pools and liquid staking take any amount but add smart-contract risk. Exchanges are easiest but you don't hold the keys. Disclosure: I use a pool.",ago(4*DAY)),
    P("accra_ultra","Pinning-worthy. Would add: check the withdrawal waiting times before you stake.",ago(3*DAY))
  ],{views:1520, pinned:true}),
  T(22,"stablecoins","USDT or USDC for marketplace escrow?","kitbag_kojo",ago(5*HR),[
    P("kitbag_kojo","Escrow here takes both. As the person getting paid I don't mind, but which do most of you hold?",ago(5*HR)),
    P("withdrawal_wanda","USDT on TRON for me, cheapest to move. USDC when I'm on Base.",ago(4*HR)),
    P("satoshi_sub","Either is fine for a few days. The bigger risk is sending on the wrong network, so always double-check it.",ago(3*HR))
  ],{views:780}),
  T(23,"tether","USDT on TRON vs Ethereum: fees and speed","withdrawal_wanda",ago(1*DAY),[
    P("withdrawal_wanda","Logged ten transfers each way. TRON was cheaper and confirmed in about a minute. Ethereum cost more but every exchange I use supports it.",ago(1*DAY)),
    P("kwame_fc","Same experience. Casinos that pay USDT almost always default to TRON.",ago(20*HR))
  ],{views:1340}),
  T(24,"usdc","Using USDC on Base for small payments","hodl_hannah",ago(3*DAY),[
    P("hodl_hannah","Paid for a logo design here in USDC on Base. Fee was a few cents and it landed instantly. Anyone had problems cashing out from Base?",ago(3*DAY)),
    P("xg_merchant","Not yet. Just check your exchange accepts deposits on Base before you send.",ago(2*DAY))
  ],{views:410}),
  T(25,"xrp","XRP for sending money home: real experiences?","accra_ultra",ago(2*DAY),[
    P("accra_ultra","Family in the UK sends money to Ghana. Has anyone actually used XRP for this rather than a remittance app?",ago(2*DAY)),
    P("kwame_fc","Tried it. The transfer was quick and cheap. The hard part is cashing out locally, so check what your exchange supports.",ago(2*DAY-4*HR)),
    P("satoshi_sub","Remember the XRP Ledger needs a destination tag for many exchange deposits. Forget it and you'll be waiting on support.",ago(1*DAY))
  ],{views:960}),
  T(26,"bnb","BNB Chain fees for small transfers","sharp_sam",ago(6*DAY),[
    P("sharp_sam","Moving small amounts between wallets. BNB Chain has been cheap for me. Any downsides compared with TRON for USDT?",ago(6*DAY)),
    P("withdrawal_wanda","Fewer casinos and marketplaces accept it, in my experience. Fine wallet to wallet.",ago(5*DAY))
  ],{views:350}),
  T(27,"solana","Phantom or Solflare?","gooner_kev",ago(9*HR),[
    P("gooner_kev","New to Solana. Which wallet do people here use and why?",ago(9*HR)),
    P("hodl_hannah","Both are fine. Pick one, back up the recovery phrase, and never sign a transaction you don't understand.",ago(8*HR))
  ],{views:520}),
  T(28,"solana","Failed transactions during busy periods","xg_merchant",ago(5*DAY),[
    P("xg_merchant","Had a few transactions fail when the network was busy. Raising the priority fee fixed it. Anyone else?",ago(5*DAY)),
    P("satoshi_sub","Yes, a small priority fee usually helps. Failed transactions still cost a tiny fee, so don't spam retries.",ago(4*DAY))
  ],{views:430}),
  T(29,"dogecoin","Does anyone actually spend DOGE?","kitfan99",ago(3*DAY),[
    P("kitfan99","Genuine question. Apart from tipping, has anyone used DOGE to pay for anything?",ago(3*DAY)),
    P("gooner_kev","Tipped a few match-thread posters with it. That's about it.",ago(2*DAY)),
    P("accra_ultra","A couple of shirt sellers here accept it. Most prefer USDT though.",ago(2*DAY-6*HR))
  ],{views:700}),
  T(30,"tron","Why do most USDT transfers here use TRON?","rookie_ruth",ago(1*DAY),[
    P("rookie_ruth","Everyone seems to use USDT on TRON. Is that just cheaper, or is there another reason?",ago(1*DAY)),
    P("withdrawal_wanda","Mostly fees and speed. You'll need a little TRX (or energy) in the wallet to pay for transfers, which catches people out.",ago(20*HR))
  ],{views:610}),
  T(31,"cardano","How Cardano staking works for beginners","satoshi_sub",ago(8*DAY),[
    P("satoshi_sub","Quick guide: you delegate ADA to a stake pool from your wallet. Your ADA never leaves your wallet and isn't locked. Rewards arrive every epoch. Disclosure: I hold some ADA.",ago(8*DAY)),
    P("courtside_kofi","Didn't know it isn't locked. That makes it much easier.",ago(7*DAY))
  ],{views:820}),
  T(32,"crypto-gambling","Crypto casinos: which ones actually pay USDT fast?","withdrawal_wanda",ago(2*DAY),[
    P("withdrawal_wanda","Starting a log of USDT withdrawal times from crypto casinos. Please include the network and amount. Check the blacklist before depositing anywhere.",ago(2*DAY)),
    P("kwame_fc","Stakeline: $180 on TRON, about 3 hours. Filed a complaint once and it got sorted.",ago(1*DAY))
  ],{views:1050}),
  // ---- Gambling section sample threads ----
  T(33,"football-betting","Both teams to score in Serie A: is the market too short?","lineswoman",ago(5*HR),[
    P("lineswoman","BTTS landed in 41% of Serie A games in my sample, but books price it like it's 50%. Am I missing something?",ago(5*HR)),
    P("accra_ultra","Pitches. Half the grounds are rock hard by March and nobody scores. I'd look at early season only.",ago(4*HR))
  ],{tags:["betting"],views:880}),
  T(34,"basketball-betting","Back-to-back fatigue and NBA totals","courtside_kofi",ago(1*DAY),[
    P("courtside_kofi","Teams on the second night of a back-to-back have gone under in 57% of games I've tracked this season. Small sample, but worth a look.",ago(1*DAY)),
    P("sharp_sam","Books know this now. The line already moves 2–3 points. Check the closing line before you get excited.",ago(20*HR))
  ],{tags:["betting"],views:430}),
  T(35,"tennis-betting","Fading favourites after five-setters","xg_merchant",ago(3*DAY),[P("xg_merchant","Players coming off a long five-setter at the Slams: is the next-round price fair? Collecting data here.",ago(3*DAY))],{tags:["betting"],views:260}),
  T(36,"live-betting","Live betting delays: how many seconds does your book give you?","withdrawal_wanda",ago(2*DAY),[
    P("withdrawal_wanda","Timed it with a stopwatch. Stakeline: about 5 seconds on football. NorthPeak: up to 9, and they reject a lot of bets after goals.",ago(2*DAY)),
    P("gooner_kev","9 seconds is long enough to watch the replay. No wonder they reject.",ago(1*DAY))
  ],{views:510}),
  T(37,"accas","Weekend acca thread: post yours with reasoning","gooner_kev",ago(9*HR),[
    P("gooner_kev","Rules: reasoning required, no 'lock of the week'. I'll start: Arsenal, Liverpool and Bayern all to win.",ago(9*HR)),
    P("kwame_fc","Bayern away? Brave. I'm swapping them for Inter double chance.",ago(8*HR))
  ],{tags:["predictions","betting"],views:1210, pinned:true}),
  T(38,"picks","Tracking thread: my picks, every result posted","sharp_sam",ago(6*DAY),[
    P("sharp_sam","Every pick goes in this thread before kick-off, with odds and stake. Results updated weekly. Current: +11.4 units over 140 bets.",ago(6*DAY)),
    P("lineswoman","This is how a picks thread should look. Pinning in Sports Betting.",ago(5*DAY))
  ],{tags:["predictions"],views:2040}),
  T(39,"esports-betting","CS2 majors: map vetoes are the edge","kitfan99",ago(4*DAY),[P("kitfan99","Most books price the match before the veto. If you know a team's map pool, there's value right after it's announced.",ago(4*DAY))],{views:300}),
  T(40,"racing","Each-way terms: who pays the most places?","accra_ultra",ago(11*HR),[
    P("accra_ultra","Big handicaps this weekend. Which books are paying 5 or 6 places, and at what fraction?",ago(11*HR)),
    P("withdrawal_wanda","Check the terms on the day. They change them on the morning of the race more often than you'd think.",ago(10*HR))
  ],{views:690}),
  T(41,"slots","High volatility vs low: what's your bankroll rule?","kwame_fc",ago(2*DAY),[
    P("kwame_fc","With $50 I'll get 20 minutes on a high-volatility slot or two hours on a low one. Which do you play and why?",ago(2*DAY)),
    P("hodl_hannah","Low. I play for time, not for the one big hit. Check the RTP in the game's info screen, it varies by casino.",ago(1*DAY))
  ],{views:820}),
  T(42,"live-casino","Crash games: anyone actually profitable?","rookie_ruth",ago(1*DAY),[
    P("rookie_ruth","Friends keep posting crash game wins. Is there any strategy, or is it all luck?",ago(1*DAY)),
    P("xg_merchant","House edge is built in, usually around 1–3%. No strategy beats it long term. Set a stop and treat it as entertainment.",ago(20*HR))
  ],{views:640}),
  T(43,"blackjack","Basic strategy chart for 6-deck, dealer stands on soft 17","sharp_sam",ago(9*DAY),[P("sharp_sam","Posting the full chart with notes on when the online rules change it. Ask questions below.",ago(9*DAY))],{views:1880, pinned:true}),
  T(44,"land-casinos","Casinos in Accra: which ones are worth visiting?","accra_ultra",ago(4*DAY),[P("accra_ultra","Looking for a decent night out with live roulette. Dress codes, minimums, anything to avoid?",ago(4*DAY))],{views:410}),
  T(45,"poker","Welcome to the poker section: read this first","lineswoman",ago(20*DAY),[P("lineswoman","Cash, tournaments, live and hand reviews each have their own board. Hand reviews: include stakes, positions and stack sizes.",ago(20*DAY))],{views:900, pinned:true}),
  T(46,"poker-cash","Moving up from NL10 to NL25: when is the bankroll ready?","kitfan99",ago(1*DAY),[
    P("kitfan99","I've got 30 buy-ins for NL25. Enough, or should I wait for 40?",ago(1*DAY)),
    P("sharp_sam","Depends on your win rate and how you handle downswings. 30 is fine if you're willing to drop back down without arguing with yourself.",ago(22*HR))
  ],{views:370}),
  T(47,"poker-mtt","Sunday tournament results thread","gooner_kev",ago(2*DAY),[P("gooner_kev","Post your Sunday results. I bubbled the $11 at 3am, as is tradition.",ago(2*DAY))],{views:280}),
  T(48,"poker-strategy","Hand review: pocket queens facing a 4-bet","xg_merchant",ago(3*DAY),[
    P("xg_merchant","NL50, 100bb deep. I open QQ from the cutoff, button 3-bets, I 4-bet, button shoves. Call or fold?",ago(3*DAY)),
    P("sharp_sam","Against most NL50 regs that's a snap call. Their shoving range has enough AK and JJ in it.",ago(2*DAY))
  ],{views:520}),
  T(49,"casino-bonuses","Max-bet rules explained: how not to lose your bonus winnings","verified_vee",ago(5*DAY),[
    P("verified_vee","Most bonus terms cap your bet while wagering, often at $5. Go over once and they can void everything. See complaint PC-1045.",ago(5*DAY)),
    P("withdrawal_wanda","Screenshot the bonus terms before you claim. They change.",ago(4*DAY))
  ],{views:1430, pinned:true}),
  T(50,"free-bets","Free bet vs bet credit: what's the difference?","rookie_ruth",ago(2*DAY),[P("rookie_ruth","Got 'bet credits' on sign-up. Are they the same as a free bet?",ago(2*DAY)),P("lineswoman","Usually the stake isn't returned with bet credits. You only get the winnings.",ago(1*DAY))],{views:390}),
  T(51,"exchanges","Laying the draw: does it still work?","xg_merchant",ago(6*DAY),[P("xg_merchant","Old exchange strategy: lay the draw pre-match, trade out after a goal. Commission eats most of it now. Anyone still doing it?",ago(6*DAY))],{views:450}),
  T(52,"fantasy","FPL Gameweek captaincy thread","gooner_kev",ago(13*HR),[P("gooner_kev","Saka or Salah? Post your captain and why.",ago(13*HR)),P("kwame_fc","Salah at home. Always Salah at home.",ago(12*HR))],{views:760}),
  T(53,"lottery-bingo","Online bingo rooms: which ones are actually busy?","kitfan99",ago(5*DAY),[P("kitfan99","Tried three bingo sites and the rooms were empty in the evening. Which ones have real players?",ago(5*DAY))],{views:180}),
  T(54,"sweepstakes","Sweepstakes casinos: how do redemptions work?","hodl_hannah",ago(7*DAY),[P("hodl_hannah","Coins vs sweeps coins, redemption minimums and KYC. Let's collect how each site handles it.",ago(7*DAY))],{views:240}),
  T(55,"matched-betting","Gubbed after three months of matched betting","withdrawal_wanda",ago(3*DAY),[P("withdrawal_wanda","Two books cut my stakes to pennies after I'd taken their offers. Anyone found ways to last longer?",ago(3*DAY))],{views:610}),
  T(56,"gambling-news","New licensing rules: what changes for players?","lineswoman",ago(2*DAY),[P("lineswoman","Summary thread for licensing and law changes. Post the country, the change and a link to the official source.",ago(2*DAY))],{views:540, pinned:true}),
  T(57,"wins-losses","Biggest win this month? Post it (and the losses)","kwame_fc",ago(1*DAY),[P("kwame_fc","Hit a 7-fold for $310 off $2. And yes, I lost the next five. Your turn.",ago(1*DAY)),P("gooner_kev","Lost a 9-fold in the 94th minute. Never again (until Saturday).",ago(20*HR))],{views:980}),
  // ---- Community sample threads ----
  T(58,"general","Introduce yourself: who do you support and where are you from?","offside_ama",ago(3*DAY),[
    P("offside_ama","New here? Say hello. Club, country, and the first match you remember.",ago(3*DAY)),
    P("kwame_fc","Kwame, Accra. Hearts of Oak. First match: the 2000 CAF Champions League final with my dad.",ago(3*DAY-2*HR)),
    P("courtside_kofi","Kofi, Kumasi. Celtics and Kotoko, don't ask how that happened.",ago(2*DAY))
  ],{views:2310, pinned:true}),
  T(59,"general","Best place to watch the big games in Accra?","gooner_kev",ago(1*DAY),[P("gooner_kev","Looking for somewhere with good screens and a decent crowd for Sunday's derby.",ago(1*DAY)),P("accra_ultra","The Dugout. Get there an hour early.",ago(20*HR))],{views:540}),
  T(60,"help","How do I change my avatar and signature?","rookie_ruth",ago(2*DAY),[P("rookie_ruth","Can't find where to upload a profile picture.",ago(2*DAY)),P("offside_ama","Settings, then Avatar & signature at the top. Pictures are cropped to a square automatically.",ago(2*DAY-3*HR))],{views:260}),
  T(61,"help","Feature request: dark mode toggle","xg_merchant",ago(5*DAY),[P("xg_merchant","The site follows my phone's dark mode, which is great. Could we also have a manual switch?",ago(5*DAY)),P("pitchside_hq","Noted. It's on the list.",ago(4*DAY))],{views:330}),
  T(62,"off-topic","What are you listening to on match day?","hodl_hannah",ago(4*DAY),[P("hodl_hannah","Pre-match playlist thread. Afrobeats until kick-off for me.",ago(4*DAY)),P("kitfan99","Old highlights commentary on YouTube. Nothing else gets me ready.",ago(3*DAY))],{views:410})
];
topicSeq = 100;

/* ---------- Operators: businesses, casinos, sportsbooks (§11, §31) ---------- */
// regulator: licence quality tier used by the Safety Index. size: small/medium/large (bigger operators naturally get more complaints).
let OPERATORS = [
  {slug:"stakeline", type:"sportsbook", name:"Stakeline", website:"stakeline.example", owner:"Stakeline Gaming Ltd", license:"Curaçao GCB OGL/2024/118", regulator:"curacao",
   countries:["GH","NG","KE","CA"], crypto:true, fiat:true, sportsbook:true, casino:true, poker:false, kyc:"On withdrawals over $2,000 equivalent",
   withdrawals:["BTC","USDT","Mobile money","Bank transfer"], claimed:true, verified:true, reps:["stakeline_rep"], affiliate:true, featured:true, warning:null, color:"#1D4ED8",
   size:"medium", est:2019, minDeposit:"$5", withdrawalLimit:"$20,000 / month", games:"Sportsbook + 1,400 casino games", languages:"English, French",
   pros:["Crypto and mobile-money payouts usually within hours","Responds to complaints quickly"], cons:["Limits winning bettors","Curaçao licence offers less player protection"], unfairTerms:[]},
  {slug:"northpeak-bet", type:"sportsbook", name:"NorthPeak Bet", website:"northpeak.example", owner:"NP Interactive N.V.", license:"Anjouan ALSI-2025-077", regulator:"anjouan",
   countries:["GH","ZA","IN"], crypto:true, fiat:false, sportsbook:true, casino:false, poker:false, kyc:"Requested on 3rd withdrawal",
   withdrawals:["BTC","ETH","USDT"], claimed:false, verified:false, reps:[], affiliate:false, featured:false, warning:null, color:"#0F766E",
   size:"small", est:2024, minDeposit:"$10", withdrawalLimit:"$5,000 / week", games:"Sportsbook only", languages:"English",
   pros:["Wide crypto support"], cons:["KYC only requested after big wins","Doesn't respond to complaints"], unfairTerms:["Can request extra verification at any time before paying winnings"]},
  {slug:"golden-reel", type:"casino", name:"Golden Reel Casino", website:"goldenreel.example", owner:"Reel Holdings Ltd", license:"Malta MGA/B2C/499/2021", regulator:"mga",
   countries:["GH","UK","DE"], crypto:false, fiat:true, sportsbook:false, casino:true, poker:true, kyc:"At sign-up",
   withdrawals:["Card","Skrill","Bank transfer"], claimed:true, verified:true, reps:[], affiliate:true, featured:false, warning:null, color:"#B45309",
   size:"medium", est:2021, minDeposit:"$10", withdrawalLimit:"$10,000 / month", games:"2,600 games, strong live casino", languages:"English, German",
   pros:["Strict MGA licence","Excellent live dealer tables"], cons:["Withdrawals can take over a week"], unfairTerms:[]},
  {slug:"blue-harbor", type:"casino", name:"Blue Harbor Casino", website:"blueharbor.example", owner:"Harbor Interactive Ltd", license:"Malta MGA/B2C/221/2016", regulator:"mga",
   countries:["GH","NG","UK","CA","IE"], crypto:true, fiat:true, sportsbook:false, casino:true, poker:true, kyc:"At first withdrawal",
   withdrawals:["Card","Bank transfer","Skrill","BTC"], claimed:true, verified:true, reps:[], affiliate:false, featured:false, warning:null, color:"#1E6FB0",
   size:"large", est:2016, minDeposit:"$10", withdrawalLimit:"$50,000 / month", games:"3,200 games from 60 providers", languages:"English, French, Spanish",
   pros:["Large, long-running operator","Fair terms, high withdrawal limits","Resolves most complaints"], cons:["Bonuses have 40× wagering"], unfairTerms:[]},
  {slug:"kumasi-kings", type:"casino", name:"Kumasi Kings Casino", website:"kumasikings.example", owner:"KK Gaming Ltd", license:"Curaçao GCB OGL/2023/402", regulator:"curacao",
   countries:["GH"], crypto:false, fiat:true, sportsbook:false, casino:true, poker:false, kyc:"At first withdrawal",
   withdrawals:["Mobile money","Bank transfer"], claimed:false, verified:false, reps:[], affiliate:false, featured:false, warning:null, color:"#B7791F",
   size:"small", est:2023, minDeposit:"$2", withdrawalLimit:"$2,000 / week", games:"900 games, local slots", languages:"English, Twi",
   pros:["Low minimum deposit","Mobile money in and out"], cons:["New and small","Slow support"], unfairTerms:["Withdrawals can be cancelled at the casino's discretion"]},
  {slug:"neon-mirage", type:"casino", name:"Neon Mirage Casino", website:"neonmirage.example", owner:"Mirage Entertainment B.V.", license:"Curaçao (sub-licence)", regulator:"curacao",
   countries:["GH","NG","IN","BR"], crypto:true, fiat:true, sportsbook:false, casino:true, poker:false, kyc:"Unclear",
   withdrawals:["BTC","USDT","Card"], claimed:false, verified:false, reps:[], affiliate:false, featured:false, warning:null, color:"#9333EA",
   size:"medium", est:2021, minDeposit:"$20", withdrawalLimit:"$4,000 / month", games:"1,800 games", languages:"English, Portuguese",
   pros:["Big game library"], cons:["Several unresolved complaints","Doesn't answer complaints","Unfair bonus and dormancy terms"], unfairTerms:["Maximum-bet rule applied to play without a bonus","Dormant accounts charged $10 a month after 30 days"]},
  {slug:"lucky-atlas", type:"casino", name:"Lucky Atlas Casino", website:"luckyatlas.example", owner:"Unknown", license:"Not disclosed", regulator:"none",
   countries:["Unknown"], crypto:true, fiat:false, sportsbook:false, casino:true, poker:false, kyc:"Unclear",
   withdrawals:["BTC"], claimed:false, verified:false, reps:[], affiliate:false, featured:false,
   warning:{status:"allegation", label:"Open scam allegation", topic:14}, color:"#6D28D9",
   size:"small", est:2025, minDeposit:"$20", withdrawalLimit:"Not stated", games:"Unknown", languages:"English",
   pros:[], cons:["No licence disclosed","Open scam allegation","Voided winnings citing bonus terms"], unfairTerms:["Bonus terms can change after you've claimed a bonus"]}
];
/* ---------- Blacklist ----------
   Staff with the "operator.warning" permission add or remove operators, with a reason that's audited.
   Blacklisted operators drop out of the Casinos & Sportsbooks list and show a red notice on their page. */
const BLACKLIST_REASONS = ["Confiscated winnings without a valid reason","Ignores complaints and our specialists","No licence, or a fake licence","Unfair or predatory terms","Copies another brand or uses fake reviews","Shut down without paying players"];
const blacklistSeed = {
  "lucky-atlas": {at:ago(9*DAY), by:"lineswoman", reasons:["Confiscated winnings without a valid reason","No licence, or a fake licence","Ignores complaints and our specialists"],
    note:"Voided a player's winnings after a bonus wager, discloses no licence and hasn't answered any complaint."},
  "neon-mirage": {at:ago(21*DAY), by:"lineswoman", reasons:["Unfair or predatory terms","Ignores complaints and our specialists"],
    note:"Applies a maximum-bet rule to play without a bonus and charges dormant accounts monthly. Several complaints left unanswered."}
};
OPERATORS.forEach(o => { o.blacklist = blacklistSeed[o.slug] || null; });
const REVIEW_CATS = ["Overall","Deposits","Withdrawals","Support","KYC","Games","Bonuses","Speed","Reliability","Crypto"];
const REVIEW_STATUSES = ["unverified","verified user","verified transaction","disputed","removed"];
const sc = arr => Object.fromEntries(REVIEW_CATS.map((c,i)=>[c,arr[i]]));
let reviewSeq = 500;
let REVIEWS = [
  {id:++reviewSeq, op:"stakeline", user:"withdrawal_wanda", stars:5, scores:sc([5,5,5,4,4,4,3,5,5,5]), title:"Fastest crypto payouts I've used", body:"Twelve withdrawals in USDT, all under four hours. KYC was quick when I hit the threshold.", status:"verified transaction", helpful:new Set(["sharp_sam","kwame_fc","verified_vee"]), unhelpful:new Set(), at:ago(12*DAY), response:{by:"stakeline_rep",body:"Thanks for the detailed log.",at:ago(11*DAY)}, history:[]},
  {id:++reviewSeq, op:"stakeline", user:"sharp_sam", stars:4, scores:sc([4,5,5,3,4,3,2,5,4,5]), title:"Good book, limits sharp players", body:"Payouts are great. They cut my limits after two winning months.", status:"verified user", helpful:new Set(["withdrawal_wanda"]), unhelpful:new Set(["accra_ultra"]), at:ago(40*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"stakeline", user:"accra_ultra", stars:4, scores:sc([4,5,4,4,4,3,4,4,4,4]), title:"Mobile money works", body:"Deposits and withdrawals via mobile money were smooth.", status:"unverified", helpful:new Set(), unhelpful:new Set(), at:ago(130*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"northpeak-bet", user:"sharp_sam", stars:2, scores:sc([2,4,1,2,1,3,3,2,2,4]), title:"KYC only after you win", body:"Deposited and played for weeks with no checks. Third withdrawal, suddenly full KYC and a 10-day hold.", status:"verified transaction", helpful:new Set(["withdrawal_wanda","verified_vee"]), unhelpful:new Set(), at:ago(20*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"golden-reel", user:"verified_vee", stars:3, scores:sc([3,4,2,3,4,5,3,2,3,1]), title:"Great games, slow cash-out", body:"Live tables are excellent. My last withdrawal took nine days.", status:"verified user", helpful:new Set(["kwame_fc"]), unhelpful:new Set(), at:ago(8*DAY), response:null, history:[{at:ago(7*DAY),stars:2,body:"Great games. Withdrawal still pending after a week."}]},
  {id:++reviewSeq, op:"lucky-atlas", user:"verified_vee", stars:1, scores:sc([1,3,1,1,1,3,1,1,1,2]), title:"Winnings voided citing bonus terms", body:"Won after clearing a bonus, account closed and balance voided. See complaint PC-1045.", status:"disputed", helpful:new Set(["sharp_sam","kwame_fc"]), unhelpful:new Set(), at:ago(5*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"blue-harbor", user:"sharp_sam", stars:5, scores:sc([5,5,5,4,5,5,3,5,5,4]), title:"Big withdrawal paid in two days", body:"Withdrew $6,400 after a good run on live blackjack. KYC took a day, money landed two days later. No drama.", status:"verified transaction", helpful:new Set(["kwame_fc","withdrawal_wanda"]), unhelpful:new Set(), at:ago(25*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"blue-harbor", user:"gooner_kev", stars:4, scores:sc([4,4,4,4,4,5,2,4,4,4]), title:"Solid, but the bonus wagering is steep", body:"Never had a payment problem. The welcome bonus is 40x though, so I skip bonuses here.", status:"verified user", helpful:new Set(["accra_ultra"]), unhelpful:new Set(), at:ago(60*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"kumasi-kings", user:"accra_ultra", stars:3, scores:sc([3,5,2,2,3,3,3,2,3,1]), title:"Easy mobile money deposits, slow withdrawals", body:"Depositing is instant. My last withdrawal got reversed once before it went through, support took two days to reply.", status:"unverified", helpful:new Set(), unhelpful:new Set(), at:ago(9*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"neon-mirage", user:"gooner_kev", stars:1, scores:sc([1,4,1,1,2,3,1,1,1,2]), title:"Max bet rule applied after I won", body:"Played without a bonus, won $3,100, then they voided it under a max-bet rule that only mentions bonus play. Complaint filed.", status:"verified transaction", helpful:new Set(["sharp_sam","kwame_fc","verified_vee"]), unhelpful:new Set(), at:ago(14*DAY), response:null, history:[]},
  {id:++reviewSeq, op:"neon-mirage", user:"accra_ultra", stars:2, scores:sc([2,4,2,1,2,4,2,2,2,3]), title:"Games are good, support isn't", body:"Huge slot library but my account was closed without explanation and they never answered emails.", status:"unverified", helpful:new Set(), unhelpful:new Set(), at:ago(30*DAY), response:null, history:[]}
];
// Rating integrity weights (§13) — admin-configurable
let WEIGHTS = {reviews:40, quality:20, verified:15, resolution:10, recency:10, community:5};

/* ---------- Complaints (§14) ----------
   Each complaint is a public case: the player, a complaint specialist (staff with
   the complaint.manage permission) and the operator's official rep talk it through.
   System lines record status changes. The outcome feeds the operator's Safety Index. */
const COMPLAINT_STATUSES = ["Open","Under Investigation","Awaiting Business","Awaiting User","Escalated","Resolved","Partially Resolved","Unresolved","Rejected","No Response","Closed"];
const STATUS_LABEL = {"Open":"Open","Under Investigation":"Specialist reviewing","Awaiting Business":"Waiting for operator","Awaiting User":"Waiting for player",
  "Escalated":"Escalated","Resolved":"Resolved","Partially Resolved":"Partially resolved","Unresolved":"Unresolved","Rejected":"Rejected",
  "No Response":"Closed: no operator response","Closed":"Closed by player"};
const OPEN_STATUSES = ["Open","Under Investigation","Awaiting Business","Awaiting User","Escalated"];
const COMPLAINT_CATS = ["Delayed withdrawal","Confiscated winnings","Account closed","KYC / verification","Bonus terms","Deposit not credited","Limits or restrictions","Other"];
const CM = (by, body, at, role) => ({by, body, at, role: role || null});
const SYS = (body, at) => ({by:"system", body, at, role:"system"});
const CASE = (id, op, user, title, cat, amount, status, at, o) => Object.assign({id, op, user, title, cat, amount, currency:"USD", refunded:0, status, at,
  specialist:null, evidence:[], messages:[], modNotes:[], followers:new Set(), contactedSupport:true}, o);
let COMPLAINTS = [
  CASE("PC-1042","stakeline","kwame_fc","USDT withdrawal stuck for three days","Delayed withdrawal",180,"Resolved",ago(18*DAY),{specialist:"lineswoman", refunded:180,
    evidence:[{name:"withdrawal-screenshot.png",public:true},{name:"support-chat.pdf",public:false}],
    messages:[CM("kwame_fc","I requested a $180 USDT withdrawal on Monday. It still shows 'processing' and live chat keeps saying 24 hours.",ago(18*DAY)),
      SYS("Specialist lineswoman took the case",ago(18*DAY-2*HR)),
      CM("lineswoman","Thanks, Kwame. I've sent your case to Stakeline. Operators have 7 days to respond.",ago(18*DAY-3*HR)),
      SYS("Status → Waiting for operator",ago(18*DAY-3*HR)),
      CM("stakeline_rep","Found it. The transaction was held by an automated check in error. It's been paid now, with our apologies.",ago(17*DAY)),
      CM("kwame_fc","Received in full. Thanks both.",ago(16*DAY)),
      SYS("Status → Resolved · $180 recovered",ago(16*DAY))],
    modNotes:[{by:"lineswoman",at:ago(16*DAY),text:"Closed after player confirmation."}]}),
  CASE("PC-1043","golden-reel","verified_vee","Nine-day withdrawal, support only says 'processing'","Delayed withdrawal",420,"Awaiting Business",ago(8*DAY),{specialist:"lineswoman",
    evidence:[{name:"cashier-history.png",public:true}],
    messages:[CM("verified_vee","Card withdrawal of $420 requested nine days ago. Account is fully verified. Support only replies with 'processing'.",ago(8*DAY)),
      SYS("Specialist lineswoman took the case",ago(7*DAY)),
      CM("lineswoman","I've contacted Golden Reel's compliance team with your details. Their deadline to reply is in 2 days.",ago(5*DAY)),
      SYS("Status → Waiting for operator",ago(5*DAY))]}),
  CASE("PC-1044","northpeak-bet","sharp_sam","KYC requested only after a big win","KYC / verification",1250,"Under Investigation",ago(15*DAY),{specialist:"lineswoman",
    evidence:[{name:"kyc-email.pdf",public:false}],
    messages:[CM("sharp_sam","Played for six weeks with no checks. After a $1,250 win they asked for full KYC and rejected my passport twice as 'unreadable'.",ago(15*DAY)),
      SYS("Specialist lineswoman took the case",ago(14*DAY)),
      CM("lineswoman","NorthPeak hasn't claimed its profile, so I've emailed their listed support address. Sam, can you upload the rejection emails?",ago(14*DAY)),
      CM("sharp_sam","Uploaded as kyc-email.pdf (private).",ago(13*DAY)),
      SYS("No operator response in 7 days. Status → Specialist reviewing",ago(8*DAY))],
    modNotes:[{by:"lineswoman",at:ago(8*DAY),text:"Operator unclaimed. Second email sent. Will close as No Response on day 14."}]}),
  CASE("PC-1045","lucky-atlas","verified_vee","Winnings voided citing bonus terms that changed","Confiscated winnings",2300,"Escalated",ago(5*DAY),{specialist:"lineswoman",
    evidence:[{name:"terms-at-signup.pdf",public:true},{name:"terms-now.pdf",public:true}],
    messages:[CM("verified_vee","Cleared a bonus, won $2,300, then my account was closed and balance voided. The rule they cite wasn't in the terms when I signed up. Both versions attached.",ago(5*DAY)),
      SYS("Specialist lineswoman took the case",ago(4*DAY)),
      CM("verified_vee","No reply from the casino at all. Escalating.",ago(3*DAY)),
      SYS("Escalated to senior moderators",ago(3*DAY))]}),
  CASE("PC-1046","neon-mirage","accra_ultra","Account closed and $950 balance kept","Account closed",950,"No Response",ago(40*DAY),{specialist:"lineswoman",
    messages:[CM("accra_ultra","My account was closed the day after a $950 win. No reason given, balance gone.",ago(40*DAY)),
      SYS("Specialist lineswoman took the case",ago(39*DAY)),
      CM("lineswoman","Contacted Neon Mirage by email and through their live chat.",ago(39*DAY)),
      SYS("Status → Waiting for operator",ago(39*DAY)),
      CM("lineswoman","Two reminders sent, no reply after 14 days. Closing as no response. This counts against Neon Mirage's Safety Index.",ago(25*DAY)),
      SYS("Status → Closed: no operator response",ago(25*DAY))]}),
  CASE("PC-1047","neon-mirage","gooner_kev","Max-bet rule applied to play without a bonus","Confiscated winnings",3100,"Unresolved",ago(14*DAY),{specialist:"lineswoman",
    evidence:[{name:"bet-history.csv",public:true},{name:"terms-section-8.png",public:true}],
    messages:[CM("gooner_kev","No bonus active. Won $3,100 on slots, then they voided it citing a $5 max-bet rule.",ago(14*DAY)),
      SYS("Specialist lineswoman took the case",ago(13*DAY)),
      CM("lineswoman","I've read section 8. The max-bet rule only mentions bonus play, so applying it here looks unfair. Contacting the casino.",ago(13*DAY)),
      CM("lineswoman","Neon Mirage replied by email that the rule applies to all play and won't pay. We consider that term unfair and have flagged it on their profile.",ago(6*DAY)),
      SYS("Status → Unresolved",ago(6*DAY))]}),
  CASE("PC-1048","blue-harbor","rookie_ruth","Mobile deposit not credited","Deposit not credited",25,"Resolved",ago(4*DAY),{specialist:"lineswoman", refunded:25,
    messages:[CM("rookie_ruth","I deposited $25 but it never showed in my balance.",ago(4*DAY)),
      SYS("Specialist lineswoman took the case",ago(4*DAY-HR)),
      CM("lineswoman","Sent to Blue Harbor's payments team.",ago(4*DAY-2*HR)),
      CM("rookie_ruth","It's in my balance now, thank you!",ago(3*DAY)),
      SYS("Status → Resolved · $25 recovered",ago(3*DAY))]}),
  CASE("PC-1049","golden-reel","kwame_fc","Bonus winnings removed after wagering","Bonus terms",60,"Rejected",ago(22*DAY),{specialist:"lineswoman",
    messages:[CM("kwame_fc","Finished wagering my bonus but $60 of winnings were removed.",ago(22*DAY)),
      SYS("Specialist lineswoman took the case",ago(21*DAY)),
      CM("lineswoman","Golden Reel shared your game history: part of the wagering was on a live game excluded in the bonus terms you accepted. The term is clearly displayed, so we can't treat this as unfair. Sorry, Kwame.",ago(18*DAY)),
      SYS("Status → Rejected",ago(18*DAY))]}),
  CASE("PC-1050","kumasi-kings","accra_ultra","Mobile money withdrawal reversed","Delayed withdrawal",140,"Awaiting User",ago(6*DAY),{specialist:"lineswoman",
    messages:[CM("accra_ultra","Withdrawal of $140 to mobile money was reversed back to my balance twice.",ago(6*DAY)),
      SYS("Specialist lineswoman took the case",ago(5*DAY)),
      CM("lineswoman","Kumasi Kings says your mobile money name doesn't match your account name. Can you confirm the names match, or upload a screenshot of your wallet profile?",ago(2*DAY)),
      SYS("Status → Waiting for player",ago(2*DAY))]}),
  CASE("PC-1051","blue-harbor","sharp_sam","Withdrawal limit lower than advertised","Limits or restrictions",800,"Partially Resolved",ago(35*DAY),{specialist:"lineswoman", refunded:400,
    messages:[CM("sharp_sam","Site says $50,000 a month, but they're paying my $800 balance out in $100 weekly chunks.",ago(35*DAY)),
      SYS("Specialist lineswoman took the case",ago(34*DAY)),
      CM("lineswoman","Blue Harbor says a reduced limit applies to accounts flagged for bonus abuse. They agreed to release $400 now and the rest weekly.",ago(28*DAY)),
      CM("sharp_sam","Got the $400. I'll accept that.",ago(27*DAY)),
      SYS("Status → Partially resolved · $400 recovered",ago(27*DAY))]}),
  CASE("PC-1052","stakeline","withdrawal_wanda","Betting limits cut after winning months","Limits or restrictions",0,"Rejected",ago(50*DAY),{specialist:"lineswoman",
    messages:[CM("withdrawal_wanda","My max stake went from $500 to $4 after two good months.",ago(50*DAY)),
      SYS("Specialist lineswoman took the case",ago(49*DAY)),
      CM("lineswoman","Sportsbooks are allowed to limit accounts under their terms, and no money is being withheld, so we can't uphold this one. It's still useful information for other members.",ago(48*DAY)),
      SYS("Status → Rejected",ago(48*DAY))]}),
  CASE("PC-1053","kumasi-kings","kitfan99","50 free spins never credited","Bonus terms",15,"Open",ago(10*HR),{
    messages:[CM("kitfan99","Signed up for the 50 free spins offer, deposited the minimum, spins never appeared. Live chat closed my ticket.",ago(10*HR)),
      SYS("Complaint submitted. A specialist will pick it up within 48 hours.",ago(10*HR))]})
];
COMPLAINTS.forEach(c => { c.statement = c.messages[0].body; c.followers.add(c.user); });
let complaintSeq = 1053;

/* ---------- Marketplace (§16) ---------- */
const MARKET_CATS = ["Items & tickets","Services","Websites","Domains","Software","Design","Development","Marketing","Advertising",
  "Sports products & collectibles","Tickets","Crypto","Jobs wanted","Jobs offered","Freelancers","Companies hiring"];
let listingSeq = 300;
let LISTINGS = [
  {id:++listingSeq, cat:"Sports products & collectibles", title:"2010 Ghana World Cup home kit, size M, signed", seller:"kitbag_kojo", price:"$240", usd:240, escrow:true, status:"Available", featured:true, at:ago(7*HR), desc:"Signed by two squad members. Certificate with serial number included. Photos of signing on request.", feedback:[]},
  {id:++listingSeq, cat:"Tickets", title:"2× Arsenal vs Liverpool, at face value", seller:"accra_ultra", price:"$90 each", status:"Pending", featured:false, at:ago(2*DAY), desc:"Can't make it. Face value only, per house rules.", feedback:[]},
  {id:++listingSeq, cat:"Development", title:"I'll build your betting tracker spreadsheet", seller:"sharp_sam", price:"$60", usd:60, escrow:true, status:"Available", featured:false, at:ago(4*DAY), desc:"Bankroll tracking, CLV, ROI by league. Google Sheets or Excel.", feedback:[]},
  {id:++listingSeq, cat:"Sports products & collectibles", title:"Arsenal 2003–04 away shirt, unsigned", seller:"kitbag_kojo", price:"$95", usd:95, escrow:true, status:"Sold", featured:false, at:ago(20*DAY), desc:"Good condition.", feedback:[{from:"kwame_fc",stars:5,text:"Exactly as described, shipped fast.",at:ago(14*DAY)}]},
  {id:++listingSeq, cat:"Jobs offered", title:"Match-thread writer for LaLiga and Serie A (paid, part-time)", seller:"pitchside_hq", price:"$15/thread", status:"Available", featured:false, at:ago(6*DAY), desc:"Write pre-match threads for GPL fixtures.", feedback:[]},
  {id:++listingSeq, cat:"Sports products & collectibles", title:"Arsenal 2025/26 home shirt, size L, worn twice", seller:"gooner_kev", price:"$45", usd:45, escrow:true, status:"Available", featured:false, at:ago(2*HR), desc:"Official shirt, no name or number. Can post anywhere in Ghana or meet in Accra.", feedback:[], approval:"pending"}
];
const SELLER_FEEDBACK = {kitbag_kojo:[5,5,5,4,5,5,5,5,4,5], sharp_sam:[5,5,4], accra_ultra:[5]};
// Marketplace category -> board
const MARKET_BOARD = {"Items & tickets":"buy-sell","Sports products & collectibles":"collectibles","Tickets":"tickets","Services":"services","Design":"design",
  "Development":"development","Marketing":"marketing","Advertising":"advertising","Websites":"websites","Domains":"domains","Software":"software",
  "Crypto":"crypto-market","Jobs wanted":"jobs-wanted","Jobs offered":"jobs-offered","Freelancers":"freelancers","Companies hiring":"hiring"};
const reviewBoard = opType => opType === "casino" ? "casino-reviews" : "sportsbook-reviews";

/* ---------- Reviews and listings live as forum topics ----------
   The review or listing record holds the structured fields (stars, scores, status, price…);
   its topic holds the discussion. topic.review / topic.listing point back to the record. */
function threadFor(rec, kind, extraReplies=[]){
  const isRev = kind === "review";
  const o = isRev ? OPERATORS.find(x=>x.slug===rec.op) : null;
  const author = isRev ? rec.user : rec.seller;
  const t = T(++topicSeq, isRev ? reviewBoard(o.type) : MARKET_BOARD[rec.cat], rec.title, author, rec.at,
    [P(author, isRev ? rec.body : rec.desc, rec.at), ...extraReplies.map(([u,b,ago_]) => P(u, b, rec.at + ago_))],
    {[kind]: rec.id, views: 120 + rec.id % 900});
  rec.thread = t.id; TOPICS.push(t); return t;
}
REVIEWS.forEach(r => {
  const extra = [];
  if (r.response) extra.push([r.response.by, r.response.body, r.response.at - r.at]);
  if (r.id === 501) extra.push(["kwame_fc","Same here, mobile money payouts landed in under two hours for me.", 2*DAY]);
  if (r.id === 504) extra.push(["withdrawal_wanda","Exactly what happened to me. They also wanted a selfie with a utility bill.", 3*DAY]);
  if (r.id === 506) extra.push(["sharp_sam","Thanks for posting the terms snapshots. That's the evidence moderators need.", DAY]);
  threadFor(r, "review", extra);
});
/* Marketplace approval: new listings start as "pending" and stay hidden from everyone but the
   seller and staff with the queue.listings permission until approved. */
LISTINGS.forEach(l => { if (!l.approval) l.approval = "approved"; });
LISTINGS.forEach(l => {
  const extra = [];
  if (l.id === 301) extra.push(["kitfan99","Is it still available? Any photos of the signing?", 2*HR], ["kitbag_kojo","Still available. Sending photos by DM.", 3*HR]);
  if (l.id === 302) extra.push(["rookie_ruth","Would love one if they're still going!", DAY]);
  threadFor(l, "listing", extra);
});

/* ---------- Private messages (messages) §21 ----------
   Members message each other one-to-one or in groups. Any member can
   always reach staff (moderators and admins): staff can't switch DMs off,
   and messages to staff never count toward New Member limits.
   kind:"staff" marks a conversation opened through "Contact staff". */
let convSeq = 0;
let CONVS = [
  {id:++convSeq, members:["kwame_fc","gooner_kev"], title:null, msgs:[
    {id:1, from:"gooner_kev", body:"You going to the watch party Saturday?", at:ago(6*HR), att:[]},
    {id:2, from:"kwame_fc", body:"Yeah, The Dugout as usual.", at:ago(5*HR), att:[]},
    {id:3, from:"gooner_kev", body:"Told you about that finish. Drinks on you.", at:ago(40*MIN), att:[]}
  ], read:{kwame_fc:2, gooner_kev:3}},
  {id:++convSeq, members:["kwame_fc","accra_ultra","gooner_kev","offside_ama"], title:"Derby day crew", msgs:[
    {id:1, from:"accra_ultra", body:"Meeting at the stadium gate 2 at 3pm.", at:ago(4*HR), att:[]},
    {id:2, from:"offside_ama", body:"I'll be in the press box. Behave.", at:ago(3*HR), att:[]}
  ], read:{kwame_fc:1, accra_ultra:2, offside_ama:2, gooner_kev:0}},
  {id:++convSeq, members:["kitbag_kojo","kitfan99"], title:null, msgs:[
    {id:1, from:"kitfan99", body:"Is the 2010 kit still available?", at:ago(3*HR), att:[]}
  ], read:{kitfan99:1, kitbag_kojo:0}},
  {id:++convSeq, members:["stakeline_rep","verified_vee"], title:null, msgs:[
    {id:1, from:"verified_vee", body:"Hi, can you check withdrawal ID SL-88213?", at:ago(30*HR), att:[]}
  ], read:{verified_vee:1, stakeline_rep:0}},
  {id:++convSeq, members:["rookie_ruth","offside_ama"], title:null, kind:"staff", msgs:[
    {id:1, from:"rookie_ruth", body:"Hi! Why can't I post links yet? I wanted to share the stadium livestream.", at:ago(50*MIN), att:[]},
    {id:2, from:"offside_ama", body:"Links unlock after 10 posts. It stops spam bots. You're at 4, so not long! Livestream links aren't allowed anyway, sorry.", at:ago(35*MIN), att:[], notice:false}
  ], read:{rookie_ruth:1, offside_ama:2}},
  {id:++convSeq, members:["kwame_fc","pitchside_hq","root_ops"], title:"Admin team", kind:"staff", msgs:[
    {id:1, from:"kwame_fc", body:"Could we get a board for the Women's Premier League? Happy to help moderate.", at:ago(3*DAY), att:[]},
    {id:2, from:"pitchside_hq", body:"Good idea. Use Request a board on the forum index so others can back it, and I'll look this week.", at:ago(2*DAY), att:[]}
  ], read:{kwame_fc:2, pitchside_hq:2, root_ops:0}},
  {id:++convSeq, members:["offside_ama","kitfan99"], title:null, msgs:[
    {id:1, from:"offside_ama", body:"Official notice: please don't post the same betting link across multiple threads. Next time it's a 7-day suspension.", at:ago(20*MIN), att:[], notice:true}
  ], read:{offside_ama:1, kitfan99:0}}
];
let BLOCKS = {hodl_hannah:new Set(["kwame_fc"])};   // blocker -> set of blocked usernames

/* ---------- Follows & bookmarks & reads ---------- */
let FOLLOWS = {kwame_fc:new Set(["topic:1","team:arsenal","team:barcelona","league:premier-league"]), sharp_sam:new Set(["topic:2","team:boston-celtics"]), rookie_ruth:new Set(["team:hearts-of-oak","topic:6"])};
let BOOKMARKS = {kwame_fc:new Set([2,12])};
let READS = {kwame_fc:{1:20,9:2,11:1}};  // topicId -> number of posts read (unread tracking)

/* ---------- Notifications (§21) ---------- */
let notifSeq = 0;
let NOTIFS = [];
function seedNotif(to, type, text, go, at, read=false){ NOTIFS.push({id:++notifSeq, to, type, text, go, at, read}); }
seedNotif("kwame_fc","mention","gooner_kev mentioned you in “Arsenal 2–1 Tottenham: match thread”","/topic/1",ago(50*MIN));
seedNotif("kwame_fc","like","3 people liked your post in “Arsenal 2–1 Tottenham”","/topic/1",ago(2*HR));
seedNotif("kwame_fc","follow","New match thread for a team you follow: Barcelona vs Real Madrid","/topic/6",ago(80*MIN));
seedNotif("kwame_fc","complaint","Your complaint PC-1042 was marked Resolved","/complaints/PC-1042",ago(16*DAY),true);
seedNotif("kwame_fc","market","kitbag_kojo left you marketplace feedback","/members/kwame_fc",ago(14*DAY),true);
seedNotif("verified_vee","review","Stakeline responded to a review you found helpful","/sportsbooks/stakeline",ago(11*DAY));
seedNotif("stakeline_rep","complaint","New complaint against Stakeline needs a response","/sportsbooks/stakeline",ago(2*DAY));
seedNotif("offside_ama","moderator","3 reports waiting in your boards","/mod",ago(30*MIN));
seedNotif("lineswoman","moderator","Complaint PC-1045 was escalated","/complaints/PC-1045",ago(3*DAY));
seedNotif("rookie_ruth","reply","accra_ultra replied in “Barcelona vs Real Madrid”","/topic/6",ago(30*MIN));
seedNotif("kitbag_kojo","market","kitfan99 messaged you about “2010 Ghana World Cup home kit”","/messages/3",ago(3*HR));

/* ---------- Reports & moderation queue (§32) ---------- */
let reportSeq = 0;
const QUEUES = [
  {id:"reports",label:"Reports"},{id:"spam",label:"Spam"},{id:"scam",label:"Scam accusations"},{id:"complaints",label:"Casino complaints"},
  {id:"listings",label:"Listing approvals"},{id:"sellers",label:"Verification"},{id:"review_disputes",label:"Review disputes"},{id:"abuse",label:"Abuse"},{id:"market",label:"Marketplace disputes"},{id:"claims",label:"Business claims"},{id:"appeals",label:"Appeals"}
];
let REPORTS = [
  {id:++reportSeq, queue:"reports", kind:"post", target:{topic:2, post:1003}, board:"sportsbooks", reason:"Affiliate link in reply", by:"sharp_sam", at:ago(40*MIN), status:"open"},
  {id:++reportSeq, queue:"spam", kind:"post", target:{topic:6, post:null}, board:"laliga", reason:"New account posting the same betting link in 5 threads", by:"system", at:ago(25*MIN), status:"open"},
  {id:++reportSeq, queue:"scam", kind:"topic", target:{topic:14}, board:"scam-accusations", reason:"Accused party has not responded in 5 days", by:"system", at:ago(1*DAY), status:"open"},
  {id:++reportSeq, queue:"listings", kind:"listingApproval", target:{listing:306}, board:null, reason:"New listing waiting for approval", by:"system", at:ago(2*HR), status:"open"},
  {id:++reportSeq, queue:"complaints", kind:"complaint", target:{complaint:"PC-1053"}, board:null, reason:"New complaint needs a specialist", by:"system", at:ago(10*HR), status:"open"},
  {id:++reportSeq, queue:"complaints", kind:"complaint", target:{complaint:"PC-1045"}, board:null, reason:"Escalated by complainant", by:"verified_vee", at:ago(3*DAY), status:"open"},
  {id:++reportSeq, queue:"review_disputes", kind:"review", target:{review:506}, board:null, reason:"Review disputed (operator unclaimed, flagged by system: review bombing check)", by:"system", at:ago(4*DAY), status:"open"},
  {id:++reportSeq, queue:"market", kind:"listing", target:{listing:301}, board:null, reason:"Questions about the signature's authenticity", by:"kitfan99", at:ago(2*HR), status:"open"},
  {id:++reportSeq, queue:"abuse", kind:"message", target:{conv:1, msg:3}, board:null, reason:"Harassment in DMs (sample)", by:"kwame_fc", at:ago(10*MIN), status:"open"},
  {id:++reportSeq, queue:"reports", kind:"topic", target:{topic:9}, board:"premier-league", reason:"Duplicate of an existing transfer thread", by:"gooner_kev", at:ago(6*HR), status:"open"}
];

/* ---------- Audit log (§34) ---------- */
let AUDIT = [
  {at:ago(16*DAY), actor:"offside_ama", action:"Complaint decision", object:"PC-1042", reason:"User confirmed payout", prev:"Awaiting User", next:"Resolved"},
  {at:ago(8*DAY), actor:"lineswoman", action:"Complaint status", object:"PC-1044", reason:"No business response in 7 days", prev:"Awaiting Business", next:"Under Investigation"},
  {at:ago(9*HR), actor:"lineswoman", action:"Lock topic", object:"topic #8", reason:"Megathread, news only", prev:"unlocked", next:"locked"},
  {at:ago(30*DAY), actor:"pitchside_hq", action:"Business verification", object:"Stakeline", reason:"Domain email + licence checked", prev:"claimed", next:"verified"}
];

/* ---------- Ads, affiliates, SEO, nav (admin config) §23 §24 §30 ---------- */
let NAV = [
  {id:"home",label:"Home",path:"/",on:true},
  {id:"sports",label:"Sports",path:"/sports",on:true},
  {id:"live",label:"Live Scores",path:"/live",ext:"scores",on:true},
  {id:"gambling",label:"Gambling",path:"/gambling",on:true, match:["/gambling","/reviews","/casinos","/sportsbooks","/complaints","/blacklist"], children:[
    {label:"Discussion", path:"/gambling", hint:"Boards and latest topics"},
    {label:"Casinos & Sportsbooks", path:"/casinos", hint:"Regular and crypto, ranked by Safety Index"},
    {label:"Complaints", path:"/complaints", hint:"Player disputes, mediated by our specialists"},
    {label:"Blacklisted casinos", path:"/blacklist", hint:"Operators we warn players to avoid"}]},{id:"crypto",label:"Crypto",path:"/crypto",on:true},{id:"market",label:"Marketplace",path:"/marketplace",on:true},
  {id:"community",label:"Community",path:"/community",on:true},{id:"members",label:"Members",path:"/members",on:false},{id:"forum",label:"Forum index",path:"/forum",on:false}
];
let SEO = [
  {path:"/", title:"Pitchside Forum: sports, betting, casino reviews and marketplace", desc:"Match threads, team pages, sportsbook and casino reviews.", index:true, canonical:"/"},
  {path:"/teams/arsenal", title:"Arsenal fans forum, fixtures and results | Pitchside Forum", desc:"Arsenal discussion, fixtures, results and predictions.", index:true, canonical:"/teams/arsenal"},
  {path:"/sportsbooks/stakeline", title:"Stakeline review: payouts, KYC, complaints | Pitchside Forum", desc:"User reviews and complaint history for Stakeline.", index:true, canonical:"/sportsbooks/stakeline"},
  {path:"/search", title:"Search | Pitchside Forum", desc:"", index:false, canonical:"/search"},
  {path:"/members/*", title:"{username} | Pitchside Forum member", desc:"", index:false, canonical:"/members/{username}"}
];
/* ---------- Home banner ads (rotating, §30) ----------
   Each banner is a paid placement on the homepage. Gambling banners only show to
   visitors who are signed in or have confirmed they're 18+. The house ad fills in
   when nothing else is eligible. */
let bannerSeq = 4;
let BANNERS = [
  {id:1, advertiser:"Stakeline", headline:"Same-day crypto payouts", text:"Bet on El Clásico with USDT and mobile money. Most withdrawals land in under 4 hours.",
   cta:"Visit Stakeline", dest:"https://stakeline.example/pitchside", bg:"#123B5E", fg:"#FFFFFF", accent:"#A9D6F5", gambling:true, partner:"stakeline",
   start:ago(10*DAY), end:NOW+20*DAY, paused:false, house:false, imps:48210, clicks:812, img:null},
  {id:2, advertiser:"KitBag Vintage", headline:"Retro kits, certified signatures", text:"Premier League, LaLiga and Serie A classics. Every signed shirt ships with a serial-numbered certificate.",
   cta:"Shop the collection", dest:"/forum/collectibles", bg:"#EAF4FC", fg:"#0E3A5B", accent:"#A9D6F5", gambling:false, partner:null,
   start:ago(3*DAY), end:NOW+25*DAY, paused:false, house:false, imps:12030, clicks:140, img:null},
  {id:3, advertiser:"The Dugout Sports Bar", headline:"Every derby on the big screen", text:"El Clásico, Sunday 8pm. Free entry for Pitchside members, show your profile at the door.",
   cta:"See the fixtures", dest:"/leagues/laliga", bg:"#F3F6F9", fg:"#1E2A35", accent:"#A9D6F5", gambling:false, partner:null,
   start:ago(1*DAY), end:NOW+6*DAY, paused:false, house:false, imps:3120, clicks:61, img:null},
  {id:4, advertiser:"Pitchside Forum", headline:"Advertise to 184,000 sports fans", text:"Banner, sidebar and sponsored-topic placements. Target by sport, league or country.",
   cta:"Advertise with us", dest:"/page/advertise", bg:"#A9D6F5", fg:"#0E3A5B", accent:"#0E3A5B", gambling:false, partner:null,
   start:ago(60*DAY), end:NOW+365*DAY, paused:false, house:true, imps:9900, clicks:205, img:null}
];
let ADS = [
  {id:1, name:"Stakeline: Featured sportsbook", placement:"Sidebar", target:"Gambling pages", start:ago(10*DAY), end:NOW+20*DAY, imps:48210, clicks:812, partner:"stakeline"},
  {id:2, name:"Kit sale banner", placement:"Leaderboard", target:"Football · Mobile", start:ago(3*DAY), end:NOW+4*DAY, imps:12030, clicks:140, partner:null}
];
let AFFILIATES = [{partner:"Stakeline", op:"stakeline", since:ago(60*DAY), clicks:1932, disclosed:true},{partner:"Golden Reel", op:"golden-reel", since:ago(40*DAY), clicks:610, disclosed:true}];
// Live scores run on a separate site with its own data feed, so the forum stays fast. Set the real address in Admin → System.
let SETTINGS = {scoresUrl:"https://scores.pitchside.example", scoresUtm:true, bannerSecs:6, ageGate:true, matchThreadLeadHrs:2, archiveAfterDays:30, provider:"SportsDataStub v1", providerOk:true, cacheTtl:30, bannedDomains:["bet-tips-guaranteed.example","free-crypto-x.example"]};


/* =====================================================================
   ESCROW (stablecoins only, non-custodial)
   Funds sit in an audited escrow smart contract. Pitchside never holds them:
   the contract can only pay the seller or refund the buyer. Moderators with
   escrow.arbitrate decide disputes. Buyer pays the platform fee on top.
   ===================================================================== */
let ESCROW_SETTINGS = {
  feePct: 1, feeMin: 10,    // platform fee: 1% or $10, whichever is higher; paid by the buyer, taken by the contract on release
  minUsd: 10, maxUsd: 5000, // per-deal limits
  autoReleaseDays: 5,       // after the seller marks it shipped/delivered
  depositHours: 24,         // unpaid deals expire
  networks: [
    {id:"tron",    chain:"Tron",    token:"USDT", gasUsd:1.10, on:true,  addr:"T"},
    {id:"base",    chain:"Base",    token:"USDC", gasUsd:0.02, on:true,  addr:"0x"},
    {id:"polygon", chain:"Polygon", token:"USDC", gasUsd:0.01, on:true,  addr:"0x"}
  ],
  // Boards where sellers may offer escrow. Tickets and P2P crypto trades are off by default.
  boards: new Set(["buy-sell","collectibles","services","design","development","marketing","advertising","digital","websites","domains","software","freelancers"])
};
// The greater of feePct of the price or the flat minimum
function escrowFee(amount){ return Math.max(ESCROW_SETTINGS.feeMin, Math.round(amount * ESCROW_SETTINGS.feePct) / 100); }
const feeRule = () => `${ESCROW_SETTINGS.feePct}% or $${ESCROW_SETTINGS.feeMin}, whichever is higher`;
const ESCROW_STATUS = {
  awaiting:{label:"Waiting for deposit", tone:"amber"}, funded:{label:"Funded", tone:"blue"}, shipped:{label:"Delivered, awaiting confirmation", tone:"blue"},
  disputed:{label:"In dispute", tone:"red"}, released:{label:"Paid out", tone:"green"}, refunded:{label:"Refunded", tone:""},
  split:{label:"Split by arbiter", tone:"amber"}, cancelled:{label:"Cancelled", tone:""}, expired:{label:"Expired, never funded", tone:""}
};
const ESCROW_OPEN = ["awaiting","funded","shipped","disputed"];
// Deterministic fake chain data for the prototype
let _seed = 7;
const rnd = () => (_seed = (_seed * 9301 + 49297) % 233280) / 233280;
const hex = n => Array.from({length:n}, () => "0123456789abcdef"[Math.floor(rnd()*16)]).join("");
const b58 = n => Array.from({length:n}, () => "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[Math.floor(rnd()*58)]).join("");
const fakeAddr = net => net === "tron" ? "T" + b58(33) : "0x" + hex(40);
const fakeTx = net => net === "tron" ? hex(64) : "0x" + hex(64);
const ESCROW_CONTRACT = {tron:"TPitchsideEscrowV1" + b58(16), base:"0x" + hex(40), polygon:"0x" + hex(40)};

// Seller payout wallets (set in Settings → Payout wallets)
USERS.kitbag_kojo.wallets = {tron: fakeAddr("tron"), evm: fakeAddr("base")};
USERS.sharp_sam.wallets   = {evm: fakeAddr("base")};
USERS.gooner_kev.wallets  = {tron: fakeAddr("tron")};
USERS.kwame_fc.wallets    = {tron: fakeAddr("tron"), evm: fakeAddr("base")};
Object.values(USERS).forEach(u => { if (!u.wallets) u.wallets = {}; });

let escrowSeq = 2000;
const EV = (at, by, text, tx) => ({at, by, text, tx: tx || null});
function mkEscrow(o){
  const net = ESCROW_SETTINGS.networks.find(n=>n.id===o.network), fee = escrowFee(o.amount);
  return Object.assign({id:"ES-" + (++escrowSeq), fee, token:net.token, chain:net.chain, contract:ESCROW_CONTRACT[o.network], dealId:hex(8),
    buyerWallet:fakeAddr(o.network), sellerWallet:fakeAddr(o.network), deadline:null, dispute:null, decision:null, payoutTx:null, events:[]}, o);
}
let ESCROWS = [
  mkEscrow({listing:304, buyer:"kwame_fc", seller:"kitbag_kojo", amount:95, network:"tron", status:"released", createdAt:ago(19*DAY),
    events:[EV(ago(19*DAY),"kwame_fc","Deal created"), EV(ago(19*DAY-20*MIN),"kwame_fc","Deposited 105.00 USDT into the escrow contract", fakeTx("tron")),
      EV(ago(18*DAY),"kitbag_kojo","Marked as shipped · GhanaPost tracking EE123456789GH"), EV(ago(15*DAY),"kwame_fc","Confirmed received. 95.00 USDT released to kitbag_kojo", fakeTx("tron"))]}),
  mkEscrow({listing:303, buyer:"accra_ultra", seller:"sharp_sam", amount:60, network:"base", status:"disputed", createdAt:ago(6*DAY),
    dispute:{by:"accra_ultra", at:ago(1*DAY), reason:"Item not as described", detail:"The spreadsheet's ROI-by-league tab is empty and the CLV formulas return errors. They haven't replied for two days."},
    events:[EV(ago(6*DAY),"accra_ultra","Deal created"), EV(ago(6*DAY-10*MIN),"accra_ultra","Deposited 70.00 USDC into the escrow contract", fakeTx("base")),
      EV(ago(5*DAY),"sharp_sam","Marked as delivered · Shared the Google Sheet by email"), EV(ago(1*DAY),"accra_ultra","Opened a dispute: Item not as described")]}),
  mkEscrow({listing:301, buyer:"gooner_kev", seller:"kitbag_kojo", amount:240, network:"tron", status:"funded", createdAt:ago(5*HR),
    events:[EV(ago(5*HR),"gooner_kev","Deal created"), EV(ago(5*HR-15*MIN),"gooner_kev","Deposited 250.00 USDT into the escrow contract", fakeTx("tron"))]})
];
ESCROWS[0].payoutTx = ESCROWS[0].events[3].tx;
LISTINGS.find(l=>l.id===301).status = "Pending";
REPORTS.push({id:++reportSeq, queue:"market", kind:"escrowDispute", target:{escrow:"ES-2002"}, board:null, reason:"Escrow dispute: Item not as described", by:"accra_ultra", at:ago(1*DAY), status:"open"});
seedNotif("kitbag_kojo","market","gooner_kev paid 250.00 USDT into escrow for “2010 Ghana World Cup home kit”. Ship it and mark it shipped.","/escrow/ES-2003",ago(5*HR));
seedNotif("sharp_sam","market","accra_ultra opened an escrow dispute on “I'll build your betting tracker spreadsheet”","/escrow/ES-2002",ago(1*DAY));


/* =====================================================================
   SELLER VERIFICATION
   Separate from roles: any member can apply. Identity documents go to an
   ID-verification provider; Pitchside stores only the result, never the
   document or ID number. Staff with seller.verify approve or reject.
   ===================================================================== */
const SELLER_RULES = {minAgeDays:30, minPosts:10, maxWarnings:0};
const VCHECKS = [
  {id:"email",   label:"Email address",   req:true,  hint:"Confirmed when you signed up"},
  {id:"phone",   label:"Phone number",    req:true,  hint:"We text you a 6-digit code"},
  {id:"id",      label:"Government ID + selfie", req:true, hint:"Checked by our ID-verification provider. Pitchside never sees or stores your document."},
  {id:"address", label:"Proof of address", req:false, hint:"Optional. A utility bill or bank letter from the last 3 months."}
];
const blankVerif = () => ({status:"none", checks:{email:false, phone:false, id:false, address:false}, phone:null, appliedAt:null, decidedAt:null, by:null, reason:null, history:[]});
Object.values(USERS).forEach(u => { u.sellerVerif = blankVerif(); u.sellerVerif.checks.email = !!u.verified; });
// kitbag_kojo: verified seller with full checks
Object.assign(USERS.kitbag_kojo.sellerVerif, {status:"verified", checks:{email:true, phone:true, id:true, address:true}, phone:"+233 •• ••• 4471",
  appliedAt:ago(400*DAY), decidedAt:ago(398*DAY), by:"lineswoman", history:[{at:ago(398*DAY), by:"lineswoman", text:"Verified"}]});
// sharp_sam: application waiting for review
Object.assign(USERS.sharp_sam.sellerVerif, {status:"pending", checks:{email:true, phone:true, id:true, address:false}, phone:"+1 •• ••• 2290", appliedAt:ago(6*HR),
  history:[{at:ago(6*HR), by:"sharp_sam", text:"Applied for verification"}]});
REPORTS.push({id:++reportSeq, queue:"sellers", kind:"sellerVerify", target:{user:"sharp_sam"}, board:null, reason:"Verification application", by:"sharp_sam", at:ago(6*HR), status:"open"});
const isVerifiedSeller = name => !!USERS[name] && USERS[name].sellerVerif.status === "verified";

/* ---------- Complaint discussions ----------
   Every complaint has two threads:
   1. The case thread (c.messages): only the player, the operator's reps and specialists post. Everyone can read it.
   2. A community discussion topic on the Complaint Discussions board: any member can reply. It isn't part of the case. */
function complaintThread(c, replies=[]){
  const t = T(++topicSeq, "complaint-talk", c.title, c.user, c.at,
    [P(c.user, c.statement, c.at),
     ...replies.map(([u, b, after]) => P(u, b, c.at + after))],
    {complaint: c.id, views: 90 + (+c.id.slice(3)) % 700});
  c.thread = t.id; TOPICS.push(t); return t;
}
const complaintTalkSeed = {
  "PC-1043": [["withdrawal_wanda","Same experience with Golden Reel last month. Nine days for me too, then it arrived with no explanation.", 2*DAY],
              ["sharp_sam","Did you send the bank reference to the specialist? That usually speeds things up.", 3*DAY]],
  "PC-1045": [["sharp_sam","No licence and a bonus rule that changes after you claim it. I'd stay well away.", DAY],
              ["gooner_kev","Thanks for posting this. I nearly deposited there last week.", 2*DAY],
              ["withdrawal_wanda","Screenshot the terms page before you claim any bonus, anywhere. It's saved me twice.", 3*DAY]],
  "PC-1046": [["kwame_fc","$950 is a lot to lose. Hope the specialist gets somewhere with them.", DAY]],
  "PC-1052": [["lineswoman","Speaking as a member, not a specialist: limiting winners is legal in most places, but it should be in the terms.", 2*DAY],
              ["xg_merchant","Same thing happened to me at two other books. It's the industry standard, sadly.", 4*DAY]]
};
COMPLAINTS.forEach(c => complaintThread(c, complaintTalkSeed[c.id] || []));

/* =====================================================================
   PAGE FURNITURE: side ad slots, bottom news ticker, clean look
   - "Clean look" hides every ad spot (side slots, ticker, homepage banner) in one switch.
   - Side slots only appear on wide screens (1600px+) so content is never squeezed.
   - Ticker sits at the bottom of every page like a TV news crawl. In production its
     live-score items come from the separate scores site's feed (small cached JSON).
   ===================================================================== */
let LAYOUT = {teamBadges:false, clean:false, sideAds:true, ticker:true, homeBanner:true, postAds:true, signatures:true, postAdRotate:"topic"};
// Side slots and the ads that run in them. Each ad has its own schedule; each slot rotates its live ads.
let SIDE_SLOTS = [
  {id:"left",  label:"Left side slot",  on:false, rotate:"time", secs:10},
  {id:"right", label:"Right side slot", on:true,  rotate:"time", secs:10}
];
let sideAdSeq = 4;
let SIDE_ADS = [
  {id:1, slot:"right", house:false, advertiser:"Stakeline", headline:"Same-day USDT payouts", text:"Bet on the weekend's football with crypto or mobile money.",
   cta:"Visit Stakeline", dest:"https://stakeline.example", aff:1, bg:"#1D4ED8", fg:"#FFFFFF", accent:"#FDE68A", gambling:true, img:null, start:ago(10*DAY), end:NOW+20*DAY, paused:false, imps:2310, clicks:41},
  {id:2, slot:"right", house:false, advertiser:"The Dugout Sports Bar", headline:"Every big game on the big screen", text:"Free entry for Pitchside members. Show your profile at the door.",
   cta:"Find us", dest:"/leagues/laliga", aff:null, bg:"#0E3A5B", fg:"#FFFFFF", accent:"#A9D6F5", gambling:false, img:null, start:ago(5*DAY), end:NOW+25*DAY, paused:false, imps:1840, clicks:22},
  {id:3, slot:"right", house:false, advertiser:"KitBag Vintage", headline:"Retro kits, certified signatures", text:"Premier League, LaLiga and Serie A classics. Every signature checked.",
   cta:"Shop the collection", dest:"/forum/collectibles", aff:null, bg:"#EAF4FC", fg:"#0E3A5B", accent:"#A9D6F5", gambling:false, img:null, start:NOW+3*DAY, end:NOW+33*DAY, paused:false, imps:0, clicks:0},
  {id:4, slot:"right", house:true, advertiser:"Pitchside Forum", headline:"Advertise here", text:"Reach sports fans on every page. Book this slot by the week.",
   cta:"Get the rates", dest:"/page/advertise", aff:null, bg:"#F3F6F9", fg:"#0E3A5B", accent:"#A9D6F5", gambling:false, img:null, start:ago(400*DAY), end:NOW+3650*DAY, paused:false, imps:310, clicks:6}
];
const TICKER_SPEEDS = {slow:30, medium:55, fast:85};   // pixels per second
let tickerSeq = 6;
let TICKER = {speed:"slow", scores:true, scoresEvery:3, label:"Pitchside Forum", items:[
  {id:1, kind:"news", text:"Match threads open 2 hours before kickoff. Follow your team to get notified.", dest:"/teams", on:true, gambling:false},
  {id:2, kind:"news", text:"New: a board for every major coin in Crypto, from Bitcoin to Cardano.", dest:"/crypto", on:true, gambling:false},
  {id:3, kind:"promo", text:"Get verified to show the ✓ badge on your marketplace listings.", dest:"/get-verified", on:true, gambling:false},
  {id:4, kind:"sponsored", text:"Stakeline: same-day USDT payouts. 18+ · Gamble responsibly.", dest:"https://stakeline.example", on:true, gambling:true},
  {id:5, kind:"news", text:"Check the blacklist before you deposit anywhere new.", dest:"/blacklist", on:true, gambling:false},
  {id:6, kind:"news", text:"Contact staff any time from the footer. Moderators reply within the hour.", dest:"/staff", on:false, gambling:false}
]};
// Sample avatar colours and signatures
Object.assign(USERS.kwame_fc, {avatarColor:"#0E7490", sig:"Arsenal till I die. USDT trader, verified on the marketplace."});
Object.assign(USERS.sharp_sam, {avatarColor:"#7C3AED", sig:"Flat stakes, closing-line value, no tipsters."});
Object.assign(USERS.withdrawal_wanda, {avatarColor:"#B45309", sig:"Logging every withdrawal so you don't have to."});
Object.assign(USERS.satoshi_sub, {avatarColor:"#CA8A04", sig:"Not financial advice. I disclose what I hold."});
Object.assign(USERS.offside_ama, {avatarColor:"#BE185D", sig:"Premier League & LaLiga moderator. Report, don't reply."});

/* =====================================================================
   AFFILIATE LINKS + AD UNDER THE FIRST POST
   Every affiliate link goes out through a tracked redirect, /go/{slug}?p={placement}.
   The redirect logs the click, then forwards to the partner URL with {placement}
   filled in as the sub-ID, so the partner's report can be matched to ours.
   Conversions arrive by postback from the partner (or are entered from their report).
   ===================================================================== */
const AFF_PLACEMENTS = {"casino-list":"Casinos & sportsbooks list", "operator-page":"Operator page", "post-ad":"Ad under first post", "side-slot":"Side ad slot", "banner":"Homepage banner", "ticker":"Ticker", "direct":"Direct /go link"};
let affSeq = 3;
let AFF_LINKS = [
  {id:1, slug:"stakeline", name:"Stakeline: sportsbook welcome", op:"stakeline", url:"https://stakeline.example/join?ref=PITCHSIDE&sub={placement}",
   network:"Stakeline Partners", deal:"$40 CPA + 25% revenue share", offer:"Welcome: 100% up to $200 in USDT", status:"active", created:ago(60*DAY), conversions:[]},
  {id:2, slug:"golden-reel", name:"Golden Reel: casino welcome", op:"golden-reel", url:"https://goldenreel.example/?btag=PS-778&s={placement}",
   network:"Reel Affiliates", deal:"35% revenue share", offer:"50 free spins, no wagering", status:"active", created:ago(40*DAY), conversions:[]},
  {id:3, slug:"blue-harbor", name:"Blue Harbor: casino", op:"blue-harbor", url:"https://blueharbor.example/r/pitchside?sub={placement}",
   network:"Harbor Partners", deal:"$60 CPA", offer:"", status:"paused", created:ago(12*DAY), conversions:[]}
];
let AFF_CLICKS = [];   // {link, placement, at, visitor, user, page}
(function seedAffiliate(){   // deterministic sample history for the last 30 days
  let x = 7; const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const places = ["casino-list","casino-list","operator-page","operator-page","operator-page","post-ad","side-slot","banner","ticker"];
  [[1, 520], [2, 210], [3, 40]].forEach(([id, n]) => { for (let i = 0; i < n; i++) {
    const at = NOW - Math.floor(rnd() * (id === 3 ? 12 : 30) * DAY);
    AFF_CLICKS.push({link:id, placement: places[Math.floor(rnd() * places.length)], at, visitor:"v" + Math.floor(rnd() * n * 0.7), user:null, page:"/" }); } });
  const conv = (id, n, amt) => { for (let i = 0; i < n; i++) AFF_LINKS[id-1].conversions.push({at: NOW - Math.floor(rnd() * 30 * DAY), event: i % 3 ? "Sign-up" : "First deposit", amount: i % 3 ? 0 : amt, placement: places[Math.floor(rnd() * places.length)], source:"postback"}); };
  conv(1, 36, 40); conv(2, 14, 22); conv(3, 2, 60);
})();
const affLinkFor = slug => AFF_LINKS.find(l => l.op === slug && l.status === "active");
function syncAffiliateFlags(){ OPERATORS.forEach(o => { if (o.blacklist) AFF_LINKS.filter(l => l.op === o.slug && l.status === "active").forEach(l => l.status = "paused"); o.affiliate = !!affLinkFor(o.slug); }); }
syncAffiliateFlags();

let postAdSeq = 3;
let POST_ADS = [
  {id:1, on:true, house:false, advertiser:"Stakeline", headline:"Same-day USDT payouts on every match", text:"Bet on the weekend's football with crypto or mobile money. Most withdrawals land in under 4 hours.",
   cta:"Claim the welcome offer", dest:"", aff:1, sections:["sports","gambling"], gambling:true, bg:"#EAF4FC", fg:"#0E3A5B", accent:"#1D4ED8", img:null, imps:4120, clicks:96},
  {id:2, on:true, house:false, advertiser:"The Dugout Sports Bar", headline:"Watch the derby on the big screen", text:"El Clásico, Sunday 8pm. Free entry for Pitchside members, show your profile at the door.",
   cta:"See what's on", dest:"/leagues/laliga", aff:null, sections:["sports","community","market","crypto"], gambling:false, bg:"#F3F6F9", fg:"#1E2A35", accent:"#A9D6F5", img:null, imps:2890, clicks:44},
  {id:3, on:true, house:true, advertiser:"Pitchside Forum", headline:"Your ad here, under the first post", text:"Seen on every topic page, right where readers start. Target by section.",
   cta:"Advertise with us", dest:"/page/advertise", aff:null, sections:["all"], gambling:false, bg:"#F3F6F9", fg:"#1E2A35", accent:"#A9D6F5", img:null, imps:610, clicks:9}
];

// Schedules: every ad and ticker item can have a start and end date, and can be paused.
POST_ADS.forEach(a => Object.assign(a, {start: a.start || ago(14*DAY), end: a.end || NOW + 60*DAY, paused: !!a.paused}));
TICKER.items.forEach(i => Object.assign(i, {start: i.start || null, end: i.end || null}));
const adStatus = a => a.paused ? "Paused" : (a.start && Date.now() < a.start) ? "Scheduled" : (a.end && Date.now() > a.end) ? "Ended" : "Live";
/* =====================================================================
   CORE: helpers, session, permissions, routing, dialogs
   ===================================================================== */
// LIVE is true on the real site (the server embeds the data as window.PS_BOOT); false in the clickable prototype.
const LIVE = typeof window !== "undefined" && !!window.PS_BOOT;
let STATS = {};
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => Number(n).toLocaleString("en-US");
function rel(t){
  const d = Date.now() - t, a = Math.abs(d), fut = d < 0;
  const s = a < MIN ? "just now" : a < HR ? Math.round(a/MIN)+"m" : a < DAY ? Math.round(a/HR)+"h" : a < 60*DAY ? Math.round(a/DAY)+"d" : Math.round(a/(30*DAY))+"mo";
  return s === "just now" ? s : fut ? "in " + s : s + " ago";
}
const dstr = t => new Date(t).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const dday = t => new Date(t).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const stars = n => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const link = (path, text, cls="") => `<a href="${LIVE?esc(path):"#"}" data-go="${esc(path)}"${cls?` class="${cls}"`:""}>${text}</a>`;
const ulink = name => USERS[name] || (LIVE && name && name !== "system") ? `<a href="${LIVE?"/members/"+esc(name):"#"}" data-go="/members/${esc(name)}" class="who">${esc(name)}</a>` : esc(name);
// Button text that stays readable on any button colour (dark letters on light colours, white on dark)
function ctaInk(hex){ const m = /^#?([0-9a-f]{6})$/i.exec(hex||""); if (!m) return "#FFFFFF";
  const [r,g,b] = [0,2,4].map(i => parseInt(m[1].slice(i,i+2),16)/255).map(c => c <= .03928 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return (.2126*r + .7152*g + .0722*b) > .4 ? "#0E3A5B" : "#FFFFFF"; }
const av = (name, cls="") => { const u = (typeof USERS !== "undefined") && USERS[name];
  if (u && u.avatar) return `<img class="avatar ${cls}" src="${u.avatar}" alt="" aria-hidden="true">`;
  return `<span class="avatar ${cls}" aria-hidden="true"${u && u.avatarColor ? ` style="background:${u.avatarColor};color:#fff"` : ""}>${esc((name||"?")[0].toUpperCase())}</span>`; };
const team = s => TEAMS.find(t => t.slug === s);
const league = s => LEAGUES.find(l => l.slug === s);
const board = s => BOARDS.find(b => b.slug === s);
const topic = id => TOPICS.find(t => t.id === +id);
const op = s => OPERATORS.find(o => o.slug === s);
// Official logo when one has been uploaded (Admin → Sports); otherwise a club-colour badge with the short code
// Team badges can be switched off sitewide in Admin → Sports for a cleaner look.
const crest = (t, size=64) => (typeof LAYOUT !== "undefined" && !LAYOUT.teamBadges) ? "" : t.logo ? `<img class="crest" src="${t.logo}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;background:#fff">`
  : `<span class="crest" style="background:${t.color};width:${size}px;height:${size}px;font-size:${size/(t.short.length>3?3.2:2.6)}px">${esc(t.short)}</span>`;
const opPath = o => (o.type === "casino" ? "/casinos/" : "/sportsbooks/") + o.slug;

/* ---------- Session ---------- */
const S = {role:"guest", user:null, path:"/", hist:[], ageOk:false, counters:{}, ui:{}};
const me = () => S.user ? USERS[S.user] : null;
const signedIn = () => !!S.user;
function counter(key){ const k = S.user + ":" + key; return S.counters[k] || 0; }
function bump(key){ const k = S.user + ":" + key; S.counters[k] = (S.counters[k] || 0) + 1; }

/* ---------- Permissions ---------- */
function perm(cap, role=S.role){ return (PERMS[cap] || {})[role] || 0; }
function can(cap){ const v = perm(cap); if (!v) return false; const u = me(); if (u && u.status !== "active" && cap !== "read") return false; return true; }
const restricted = cap => perm(cap) === "r";
const isStaff = () => can("moderate");
const STAFF_ROLES = ["moderator","senior_moderator","admin","super_admin"];
const isStaffUser = name => !!USERS[name] && STAFF_ROLES.includes(USERS[name].role);
const isAdminUser = name => !!USERS[name] && ["admin","super_admin"].includes(USERS[name].role);

/* ---------- Moderator permissions ---------- */
function modProfile(name){
  const u = USERS[name]; if (!u) return null;
  if (!MOD_PROFILES[name]) MOD_PROFILES[name] = {template: u.role === "senior_moderator" ? "senior" : "board", allow:new Set(), deny:new Set(), suspendMaxDays:7};
  return MOD_PROFILES[name];
}
function modTemplate(name){ const p = modProfile(name); return MOD_TEMPLATES.find(t => t.id === p.template) || MOD_TEMPLATES[0]; }
function modPerms(name){
  const u = USERS[name]; if (!u) return new Set();
  if (isAdminUser(name)) return new Set(ALL_MOD_KEYS);
  if (!STAFF_ROLES.includes(u.role)) return new Set();
  const p = modProfile(name), s = new Set(modTemplate(name).perms);
  p.allow.forEach(k => s.add(k)); p.deny.forEach(k => s.delete(k));
  return s;
}
const modAllBoards = (name=S.user) => isAdminUser(name) || (isStaffUser(name) && modTemplate(name).allBoards);
const modBoardsOf = name => BOARDS.filter(b => b.mods.includes(name));
// mp(key): may the signed-in staff member do this? mp(key, board): ...on this board?
function mp(key, slug){
  if (!S.user || !can("moderate")) return false;
  if (!modPerms(S.user).has(key)) return false;
  return slug ? canModBoard(slug) : true;
}
function canModBoard(slug){
  if (!can("moderate")) return false;
  if (modAllBoards()) return true;
  const b = board(slug); if (!b) return false;
  const parent = b.parent ? board(b.parent) : null;
  return b.mods.includes(S.user) || (!!parent && parent.mods.includes(S.user));
}
// Sections that open in later phases (marketplace, casino reviews…) stay hidden on the live site until an admin switches them on.
const featureOn = k => !LIVE || !!((SETTINGS.features || {})[k]);
const boardFeatureOff = b => LIVE && ((b.cat === "market" && !featureOn("marketplace")) || (b.kind === "review" && !featureOn("casinos")) || (b.slug === "complaint-talk" && !featureOn("complaints")));
const canReadBoard = b => b.readRoles.includes(S.role) && !boardFeatureOff(b);
const canPostBoard = b => can("topic") && b.postRoles.includes(S.role);
const isRep = slug => { const o = OPERATORS.find(x => x.slug === slug); return !!(S.user && S.role === "business" && o && o.reps.includes(S.user)); };

// Content checks shared by topics, replies, DMs, listings (§33)
function contentProblem(text){
  if (!text.trim()) return "Write something first.";
  const hasLink = /(https?:\/\/|www\.)\S+/i.test(text);
  if (hasLink && restricted("links")) return `New members can't post links yet. Links unlock after ${LIMITS.newMemberPostsToGraduate} posts.`;
  const bad = SETTINGS.bannedDomains.find(d => text.toLowerCase().includes(d));
  if (bad) return `Links to ${bad} are blocked on Pitchside.`;
  return null;
}

/* ---------- Side effects ---------- */
function notify(to, type, text, go){ if (LIVE) return; if (!to || to === S.user || !USERS[to]) return; seedNotif(to, type, text, go, Date.now()); }
function audit(action, object, reason, prev, next){ if (LIVE) return; AUDIT.unshift({at:Date.now(), actor:S.user, action, object, reason, prev, next}); }
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2800);
}

/* ---------- Dialogs ---------- */
let modalSubmit = null;
function modal({title, body, submit="Save", onSubmit, danger=false, cancel="Cancel", noCancel=false}){
  const f = $("#modalForm");
  f.innerHTML = `<h3>${esc(title)}</h3>${body}<p class="err" id="mErr" hidden></p>
    <div class="dacts">${noCancel?"":`<button type="button" class="btn" data-close>${esc(cancel)}</button>`}
    ${submit ? `<button type="submit" class="btn ${danger?"danger":"primary"}">${esc(submit)}</button>` : ""}</div>`;
  modalSubmit = onSubmit;
  $("#modal").showModal();
  const first = f.querySelector("input:not([type=hidden]):not([type=checkbox]),textarea,select");
  if (first) first.focus();
}
function closeModal(){ $("#modal").close(); modalSubmit = null; }
$("#modalForm").addEventListener("submit", e => {
  e.preventDefault();
  if (!modalSubmit) return closeModal();
  const showErr = err => { const p = $("#mErr"); if (p){ p.textContent = err; p.hidden = false; } };
  const res = modalSubmit(e.target);
  // A handler may return an error message, or a promise (server call) that resolves to one.
  if (res && typeof res.then === "function"){
    const btn = e.target.querySelector('button[type=submit]'); if (btn){ btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Working…"; }
    const cur = modalSubmit;
    res.then(err => { if (modalSubmit !== cur && !$("#modal").open) { render(); return; }
        if (err){ if (btn){ btn.disabled = false; btn.textContent = btn.dataset.label; } showErr(err); return; }
        if (modalSubmit === cur) closeModal(); render(); })
      .catch(x => { if (btn){ btn.disabled = false; btn.textContent = btn.dataset.label; } showErr(x && x.message ? x.message : "Something went wrong. Try again."); });
    return;
  }
  if (res){ showErr(res); return; }
  closeModal(); render();
});
$("#modalForm").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(); });
const val = (f, name) => (f.elements[name] ? f.elements[name].value : "").trim();

function askReason(title, cb, {submit="Confirm", danger=false, extra=""} = {}){
  modal({title, submit, danger, body:`${extra}<label>Reason <span class="hint">Recorded in the audit log.</span><textarea name="reason" required></textarea></label>`,
    onSubmit: f => { const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful."; cb(r, f); }});
}
function needSignIn(why){
  if (LIVE) return ACT.signIn(null, why);
  modal({title:"Sign in to continue", submit:"Sign in", body:`<p class="muted" style="margin:0">${esc(why)}</p>
    <p class="hint" style="margin:0">In this prototype, signing in switches you to the Member view.</p>`,
    onSubmit: () => { setRole("member"); toast("Signed in as kwame_fc"); }});
}

/* ---------- Roles ---------- */
function setRole(r){
  S.role = r; S.user = DEMO[r] || null;
  $("#role").value = r;
}

/* ---------- Router ---------- */
function go(path){ closeMenu(); if (path !== S.path) S.hist.push(S.path); S.path = path;
  if (LIVE && location.pathname + location.search !== path) history.pushState({}, "", path);
  render(); window.scrollTo(0,0); }
function parse(path){
  const [p, q=""] = path.split("?");
  const seg = p.split("/").filter(Boolean);
  const qs = Object.fromEntries(q.split("&").filter(Boolean).map(x => x.split("=").map(decodeURIComponent)));
  return {seg, qs};
}

/* ---------- Shell ---------- */
const ICON = {
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  msg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};
function unreadNotifs(){ return S.user ? NOTIFS.filter(n => n.to === S.user && !n.read).length : 0; }
function myConvs(){ return S.user ? CONVS.filter(c => c.members.includes(S.user) && !c.left?.includes(S.user)) : []; }
function convUnread(c){ return c.msgs.slice(c.read[S.user] || 0).filter(m => m.from !== S.user).length; }
function unreadMsgs(){ return myConvs().reduce((n,c) => n + convUnread(c), 0); }

function renderShell(){
  const u = me();
  const area = $("#userArea");
  if (!u){
    area.innerHTML = `<button class="btn" type="button" data-act="signIn">Sign in</button><button class="btn primary" type="button" data-act="register">Join free</button>`;
  } else {
    const n = unreadNotifs(), m = unreadMsgs();
    area.innerHTML = `
      <a class="iconbtn" href="#" data-go="/messages" title="Messages" aria-label="Messages${m?`, ${m} unread`:""}">${ICON.msg}${m?`<span class="badge">${m}</span>`:""}</a>
      <a class="iconbtn" href="#" data-go="/notifications" title="Notifications" aria-label="Notifications${n?`, ${n} unread`:""}">${ICON.bell}${n?`<span class="badge">${n}</span>`:""}</a>
      ${isStaff()?`<a class="iconbtn" href="#" data-go="/mod" title="Moderation queue" aria-label="Moderation queue">${ICON.shield}${openReports().length?`<span class="badge">${openReports().length}</span>`:""}</a>`:""}
      ${can("manageCategories")?`<a class="iconbtn" href="#" data-go="/admin" title="Admin dashboard" aria-label="Admin dashboard">${ICON.gear}</a>`:""}
      <a class="who" href="#" data-go="/members/${esc(u.name)}">${av(u.name)}<span>${esc(u.name)}</span></a>
      <button class="btn small ghost" type="button" data-act="signOut">Sign out</button>`;
  }
  const cur = sectionCur();
  const map = {"/teams":"/sports","/leagues":"/sports","/events":"/sports","/get-verified":"/marketplace","/escrow":"/marketplace","/staff":"/members","/topic":"/forum","/forum":"/forum","/casinos":"/gambling","/sportsbooks":"/gambling","/complaints":"/gambling","/reviews":"/gambling","/blacklist":"/gambling"};
  const active = map[cur] || cur;
  const caret = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  $("#nav").innerHTML = NAV.filter(n => n.on).map(n => n.ext
    ? scoresLink("", esc(n.label))
    : n.children
    ? `<button type="button" class="dd" id="dd-${n.id}" aria-haspopup="true" aria-expanded="false" data-menu="${n.id}"${(n.match||[]).includes(cur)?' aria-current="page"':""}>${esc(n.label)}${caret}</button>`
    : `<a href="#" data-go="${n.path}"${(n.path===active || (n.path!=="/" && active===n.path))?' aria-current="page"':""}>${esc(n.label)}</a>`).join("");
}
/* Nav dropdown menu: positioned against the viewport so the scrolling nav bar doesn't clip it. */
function closeMenu(){ const m = $("#navMenu"); if (m) m.remove(); $$("nav.main .dd").forEach(b => b.setAttribute("aria-expanded","false")); }
function openMenu(btn){
  closeMenu();
  const item = NAV.find(n => n.id === btn.dataset.menu); if (!item) return;
  const cur = "/" + (parse(S.path).seg[0] || "");
  const m = document.createElement("div");
  m.className = "menu"; m.id = "navMenu"; m.setAttribute("role","menu"); m.setAttribute("aria-labelledby", btn.id);
  m.innerHTML = item.children.map(c => `<a href="#" role="menuitem" data-go="${c.path}"${c.path===S.path.split("?")[0]||c.path===cur||(c.path==="/live"&&cur==="/events")?' aria-current="page"':""}>${esc(c.label)}${c.hint?`<small>${esc(c.hint)}</small>`:""}</a>`).join("");
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 4) + "px";
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
  btn.setAttribute("aria-expanded","true");
  m.querySelector("a").focus({preventScroll:true});
}
document.addEventListener("click", e => {
  const btn = e.target.closest("nav.main .dd");
  if (btn){ btn.getAttribute("aria-expanded")==="true" ? closeMenu() : openMenu(btn); return; }
  if (!e.target.closest("#navMenu")) closeMenu();
}, true);
document.addEventListener("keydown", e => {
  const m = $("#navMenu"); if (!m) return;
  const items = $$("a", m), i = items.indexOf(document.activeElement);
  if (e.key === "Escape"){ const id = m.getAttribute("aria-labelledby"); closeMenu(); document.getElementById(id)?.focus(); }
  if (e.key === "ArrowDown"){ e.preventDefault(); items[(i+1) % items.length].focus(); }
  if (e.key === "ArrowUp"){ e.preventDefault(); items[(i-1+items.length) % items.length].focus(); }
});
window.addEventListener("resize", closeMenu);
window.addEventListener("scroll", closeMenu, {passive:true});

/* ---------- Links to the separate live scores site ----------
   Scores, live minutes, stats, lineups, tables and results all live there. The forum keeps
   fixtures (for match threads and predictions) and every discussion. */
function scoresUrl(path=""){
  const base = (SETTINGS.scoresUrl || "").replace(/\/$/, ""), u = base + path;
  return SETTINGS.scoresUtm ? u + (u.includes("?") ? "&" : "?") + "utm_source=pitchside&utm_medium=forum" : u;
}
const scoresHost = () => (SETTINGS.scoresUrl || "").replace(/^https?:\/\//, "").split("/")[0];
const scoresLink = (path, label, cls="") => `<a href="${esc(scoresUrl(path))}" target="_blank" rel="noopener" data-ext="scores"${cls?` class="${cls}"`:""}>${label} <span aria-hidden="true">↗</span><span class="sr"> (opens the live scores site in a new tab)</span></a>`;
function scoresPanel(path, title, text){
  return `<section class="panel scorespanel"><h3 class="ph">${title}</h3><p style="margin:0 0 10px;font-size:.93rem">${text}</p>${scoresLink(path, "Open live scores", "btn primary small")}<p class="muted" style="margin:8px 0 0;font-size:.8rem">On ${esc(scoresHost())}, our live scores site. Opens in a new tab.</p></section>`;
}
document.addEventListener("click", e => {
  const a = e.target.closest('a[data-ext="scores"]'); if (!a) return;
  if (/\.example$/.test(scoresHost())) { e.preventDefault(); e.stopPropagation(); toast(LIVE ? "The live scores site address isn't set yet. An admin can add it in Admin → System." : `Prototype: this opens ${scoresHost()} in a new tab. Set the real address in Admin → System.`); }
}, true);
// Which top-level section the current page belongs to. Gambling-category boards and their topics count as Gambling.
function sectionCur(){
  const {seg} = parse(S.path), cur = "/" + (seg[0] || "");
  let b = null;
  if (cur === "/forum" && seg[1]) b = board(seg[1]);
  if (cur === "/topic" && seg[1]) { const t = topic(seg[1]); b = t && board(t.board); }
  return b && b.cat === "gambling" ? "/gambling" : cur;
}
// Sub-menu shown at the top of every page in a section that has a dropdown (Sports, Gambling)
function sectionSubnav(){
  const cur = sectionCur(), full = S.path.split("?")[0];
  const item = NAV.find(n => n.children && (n.match||[]).includes(cur)); if (!item) return "";
  return `<nav class="subnav" aria-label="${esc(item.label)} sections">${item.children.map(c => { const on = c.path === full || (c.path === cur && cur !== "/gambling") || (c.path==="/live" && cur==="/events") || (c.path==="/gambling" && full==="/reviews") || (c.path==="/casinos" && cur==="/sportsbooks");
    return `<a href="#" data-go="${c.path}"${on?' aria-current="page"':""}>${esc(c.label)}</a>`; }).join("")}</nav>`;
}
function renderFooter(){
  const L = [["Rules","/page/rules"],["Terms","/page/terms"],["Privacy","/page/privacy"],["Cookies","/page/cookies"],["Gambling disclaimer","/page/gambling"],
    ["Responsible gambling","/forum/responsible-gambling"],["Ad & affiliate disclosures","/page/disclosures"],["Copyright / DMCA","/page/dmca"],["Become a moderator","/page/moderators"],["Contact staff","/staff"]];
  $("#footNav").innerHTML = L.map(([t,p]) => link(p, t)).join("") + scoresLink("", "Live scores");
}
/* =====================================================================
   VIEWS A: home, forum, topics, sports, leagues, teams, events, live
   ===================================================================== */
const crumbs = (...items) => `<nav class="crumbs" aria-label="Breadcrumb">${link("/","Home")}${items.map(([t,p]) => `<span>${p?link(p,esc(t)):esc(t)}</span>`).join("")}</nav>`;
const phead = (title, sub="", acts="") => `<div class="phead"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:""}</div>${acts?`<div class="acts">${acts}</div>`:""}</div>`;
const lastAt = t => t.posts[t.posts.length-1].at;
const visiblePosts = t => t.posts.filter(p => !p.hidden || canModBoard(t.board) || p.author === S.user);
function isUnread(t){
  if (!S.user) return false;
  const r = (READS[S.user] || {})[t.id];
  return r === undefined ? (Date.now() - lastAt(t) < DAY) : r < t.posts.length;
}
function topicRow(t){
  const b = board(t.board);
  const flags = [t.pinned?'<span class="pill solid">Pinned</span>':"", t.locked?'<span class="pill amber">Locked</span>':"", t.archived?'<span class="pill">Archived</span>':"", t.auto?'<span class="pill blue">Auto</span>':""].join("");
  const tags = t.tags.map(s => link("/tag/"+s, "#"+esc((TAGS.find(x=>x.slug===s)||{name:s}).name))).join(" ");
  return `<li class="${t.pinned?"pinned":""}">
    <div style="min-width:0"><h4>${isUnread(t)?'<span class="new">New</span> ':""}${link("/topic/"+t.id, esc(t.title))}</h4>
      <div class="meta">${topicExtras(t)}${b?link("/forum/"+b.slug, esc(b.name)):""}${flags}<span>by ${ulink(t.author)}</span>${tags}</div></div>
    <div class="stats"><div><strong class="num">${fmt(t.posts.length-1)}</strong> replies · <span class="num">${fmt(t.views)}</span> views</div><div>last ${rel(lastAt(t))}</div></div>
  </li>`;
}
const topicList = (list, empty="No topics yet.") => list.length ? `<ul class="tlist">${list.map(topicRow).join("")}</ul>` : `<div class="empty">${empty}</div>`;
// Removed reviews/listings stay visible to their author and to staff who can act on them.
const hiddenTopic = t => t.deleted
  || (t.review && (REVIEWS.find(r=>r.id===t.review)||{}).status === "removed" && !mp("review.moderate") && t.author !== S.user)
  || (t.listing && (LISTINGS.find(l=>l.id===t.listing)||{}).removed && !mp("listing.remove") && t.author !== S.user)
  || (t.listing && (LISTINGS.find(l=>l.id===t.listing)||{}).approval !== "approved" && !mp("queue.listings") && t.author !== S.user);
const listingOf = t => t && t.listing ? LISTINGS.find(l=>l.id===t.listing) : null;
const readable = () => TOPICS.filter(t => { const b = board(t.board); return b && canReadBoard(b) && !hiddenTopic(t); });
function pager(total, per, cur, key){
  const pages = Math.ceil(total / per); if (pages <= 1) return "";
  let h = `<nav class="pager" aria-label="Pages">`;
  for (let i=1;i<=pages;i++) h += `<button type="button" data-act="page" data-key="${key}" data-p="${i}"${i===cur?' aria-current="true"':""}>${i}</button>`;
  return h + `<span class="muted" style="margin-left:6px;font-size:.85rem">${fmt(total)} total</span></nav>`;
}
const pageOf = key => (S.ui.pages || {})[key] || 1;

/* ---------- Home ---------- */
function vHome(){
  const trending = readable().filter(t=>!t.archived).sort((a,b) => (b.pinned-a.pinned) || (lastAt(b)-lastAt(a))).slice(0, 8);
  const u = me();
  const fol = u ? [...(FOLLOWS[u.name]||[])] : [];
  const posts = TOPICS.reduce((n,t)=>n+t.posts.length,0);
  return `
  <section class="hero" style="align-items:stretch">
    ${adsOn("homeBanner") ? adBanner() : ""}
    <div class="panel pulse"><h3 class="ph">Community pulse</h3><dl>
      ${LIVE ? `<div><dd>${fmt(STATS.members||0)}</dd><dt>members</dt></div><div><dd id="online">${fmt(STATS.online||0)}</dd><dt>online now</dt></div>
      <div><dd>${fmt(STATS.topicsToday||0)}</dd><dt>topics today</dt></div><div><dd>${fmt(STATS.postsToday||0)}</dd><dt>posts today</dt></div></dl></div>`
      : `<div><dd>184,207</dd><dt>members</dt></div><div><dd id="online">3,412</dd><dt>online now</dt></div>
      <div><dd>${fmt(926 + TOPICS.length - 14)}</dd><dt>topics today</dt></div><div><dd>${fmt(11000 + posts)}</dd><dt>posts today</dt></div></dl></div>`}
  </section>
  <div class="cols">
    <div class="stack">
      <section><div class="spread" style="margin-bottom:10px"><h2 class="sec" style="margin:0">Trending right now</h2>${link("/forum","Forum index")}</div>
        <div class="panel flush">${topicList(trending)}</div></section>
    </div>
    <aside class="stack">
      ${u ? `<section class="panel"><h3 class="ph">Following ${link("/settings","Manage")}</h3>${fol.length ? `<ul class="tlist" style="font-size:.93rem">${fol.map(f => { const [k,v] = f.split(":");
          const t = k==="team"?team(v):k==="league"?league(v):topic(v); if(!t) return "";
          const p = k==="team"?"/teams/"+v:k==="league"?"/leagues/"+v:"/topic/"+v;
          return `<li style="grid-template-columns:auto minmax(0,1fr);padding:7px 0;align-items:start"><span class="pill">${k}</span>${link(p, esc(t.name||t.title))}</li>`; }).join("")}</ul>` : `<p class="muted" style="margin:0">Follow teams, leagues and topics to see them here.</p>`}</section>` : ""}
      <section class="panel"><h3 class="ph">Boards</h3>${CATEGORIES.slice().sort((a,b)=>a.order-b.order).map(c => `<div style="margin-bottom:10px"><strong>${esc(c.name)}</strong><div class="meta">${BOARDS.filter(b=>b.cat===c.id&&!b.parent&&canReadBoard(b)).sort((a,b)=>a.order-b.order).map(b=>link("/forum/"+b.slug, esc(b.name))).join(" · ")}</div></div>`).join("")}</section>
      <section class="panel"><h3 class="ph">Safest casinos ${link("/casinos","All")}</h3>${OPERATORS.filter(o=>o.type==="casino" && !o.blacklist).sort((a,b)=>safety(b).score-safety(a).score).slice(0,3).map(o=>`<div class="spread" style="padding:6px 0">${link(opPath(o), esc(o.name))}${safetyBadge(o,"sm")}</div>`).join("")}<p class="muted" style="margin:8px 0 0;font-size:.82rem">Safety Index from licence, complaint handling, terms and member reviews. ${link("/complaints","Complaint Center")}</p></section>
      <section class="panel"><h3 class="ph">Keeping Pitchside safe</h3><p style="margin:0 0 8px" class="muted">Every board has a volunteer moderator. Report a post and a mod reviews it, usually within the hour. Every moderation action is logged and can be appealed.</p>${link("/page/rules","Read the rules")}</section>
    </aside>
  </div>`;
}

/* ---------- Forum index & boards ---------- */
function boardStats(b){ const ts = TOPICS.filter(t => (t.board === b.slug || board(t.board)?.parent === b.slug) && !hiddenTopic(t)); return {topics: ts.length, posts: ts.reduce((n,t)=>n+t.posts.length,0), last: ts.sort((a,c)=>lastAt(c)-lastAt(a))[0]}; }
function boardRows(list){
  return `<div class="tw"><table class="t"><thead><tr><th>Board</th><th class="n">Topics</th><th class="n">Posts</th><th>Last post</th></tr></thead><tbody>${list.map(b => { const s = boardStats(b), subs = BOARDS.filter(x=>x.parent===b.slug&&canReadBoard(x));
    return `<tr><td>${link("/forum/"+b.slug, esc(b.name))}<div class="muted" style="font-size:.86rem">${esc(b.desc)}</div>
      ${subs.length?`<div class="meta">Sub-boards: ${subs.map(x=>link("/forum/"+x.slug, esc(x.name))).join(", ")}</div>`:""}
      ${b.mods.length?`<div class="meta">Moderators: ${b.mods.map(ulink).join(", ")}</div>`:""}</td>
      <td class="n">${fmt(s.topics)}</td><td class="n">${fmt(s.posts)}</td><td style="min-width:160px;font-size:.86rem">${s.last?`${link("/topic/"+s.last.id, esc(s.last.title.slice(0,40)))}<div class="muted">${rel(lastAt(s.last))}</div>`:"—"}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function vForum(){
  return crumbs(["Forum"]) + phead("Forum", "Category → board → sub-board → topic → post. Admins can add, rename and reorder all of these.", signedIn()?`<button class="btn primary" type="button" data-act="newTopic">New topic</button>`:"") +
    CATEGORIES.slice().sort((a,b)=>a.order-b.order).map(c => { const bs = BOARDS.filter(b=>b.cat===c.id && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
      return bs.length ? `<section class="panel" style="margin-bottom:16px"><h2 class="sec">${esc(c.name)}${c.gated?' <span class="pill amber">18+</span>':""}</h2>${boardRows(bs)}</section>` : ""; }).join("");
}
function vCategory(catId, title, intro, extra=""){
  const c = CATEGORIES.find(x=>x.id===catId);
  const bs = BOARDS.filter(b=>b.cat===catId && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
  const ids = BOARDS.filter(b=>b.cat===catId).map(b=>b.slug);
  const ts = readable().filter(t => ids.includes(t.board)).sort((a,b)=>(b.pinned-a.pinned)||(lastAt(b)-lastAt(a)));
  return crumbs([title]) + phead(esc(title), intro, signedIn()?`<button class="btn primary" type="button" data-act="newTopic" data-cat="${catId}">New topic</button>`:"") +
    extra + `<div class="cols"><div class="stack"><section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Latest in ${esc(title)}</h3></div>${topicList(ts)}</section></div>
    <aside class="stack"><section class="panel"><h3 class="ph">Boards</h3>${bs.map(b=>`<div style="padding:6px 0;border-top:1px solid var(--line)">${link("/forum/"+b.slug, `<strong>${esc(b.name)}</strong>`)}<div class="muted" style="font-size:.86rem">${esc(b.desc)}</div></div>`).join("")}</section></aside></div>`;
}
function vBoard(slug){
  const b = board(slug); if (!b) return vMissing("That board doesn't exist.");
  if (!canReadBoard(b)) return vMissing("You don't have access to this board.");
  const c = CATEGORIES.find(x=>x.id===b.cat), parent = b.parent ? board(b.parent) : null;
  if (c.gated && gated()) return ageGate();
  const subs = BOARDS.filter(x=>x.parent===slug && canReadBoard(x));
  const tag = S.ui["tag:"+slug] || "all";
  let ts = TOPICS.filter(t => (t.board === slug || (board(t.board)||{}).parent === slug) && !hiddenTopic(t) && (tag==="all" || t.tags.includes(tag)) && (!(b.kind==="listing" && S.ui.verOnly) || isVerifiedSeller(t.author)));
  ts.sort((a,b)=>(b.pinned-a.pinned)||(lastAt(b)-lastAt(a)));
  const per = 15, p = pageOf("b:"+slug);
  const tagsHere = [...new Set(TOPICS.filter(t=>t.board===slug).flatMap(t=>t.tags))];
  const postOk = canPostBoard(b);
  const why = b.replyRoles && !postOk ? `<div class="notice" style="margin-bottom:12px">A topic opens automatically for every complaint. Reply in any of them to share your experience. The official case is linked at the top of each topic.</div>` : !signedIn() ? "" : !b.postRoles.includes(S.role) ? `<div class="notice amber" style="margin-bottom:12px"><strong>Read-only for you.</strong> ${esc(roleLabel(S.role))} accounts can't start topics on this board.</div>` : "";
  return crumbs(["Forum","/forum"],[c.name, null], ...(parent?[[parent.name,"/forum/"+parent.slug]]:[]), [b.name]) +
    phead(esc(b.name), esc(b.desc) + (b.mods.length?` · Moderated by ${b.mods.map(ulink).join(", ")}`:""),
      (signedIn() && !isStaff() ? `<button class="btn" type="button" data-act="contactStaff" data-to="board" data-board="${slug}">Message the moderators</button>` : "") +
      (b.kind ? kindButton(b) : postOk ? `<button class="btn primary" type="button" data-act="newTopic" data-board="${slug}">New topic</button>` : (!signedIn()?`<button class="btn" type="button" data-act="signIn">Sign in to post</button>`:""))) + (b.kind ? kindNotice(b) : why) +
    (subs.length ? `<div class="grid" style="margin-bottom:16px">${subs.map(x=>`<a class="card" href="#" data-go="/forum/${x.slug}"><h3>${esc(x.name)}</h3><p>${esc(x.desc)}</p><p class="meta" style="margin-top:6px">${boardStats(x).topics} topics</p></a>`).join("")}</div>` : "") +
    (b.kind==="listing" ? `<label class="row" style="gap:6px;font-size:.92rem;margin-bottom:10px"><input type="checkbox" id="verOnly" data-act="verOnly" ${S.ui.verOnly?"checked":""}> Verified members only</label>` : "") +
    (tagsHere.length ? `<div class="tabs" role="group" aria-label="Filter by tag"><button type="button" data-act="boardTag" data-board="${slug}" data-tag="all" aria-pressed="${tag==="all"}">All</button>${tagsHere.map(x=>`<button type="button" data-act="boardTag" data-board="${slug}" data-tag="${x}" aria-pressed="${tag===x}">#${esc((TAGS.find(y=>y.slug===x)||{name:x}).name)}</button>`).join("")}</div>`:"") +
    `<section class="panel flush">${topicList(ts.slice((p-1)*per, p*per), "No topics on this board yet. Start the first one.")}</section>${pager(ts.length, per, p, "b:"+slug)}`;
}
function vTag(slug){
  const tg = TAGS.find(t=>t.slug===slug); if (!tg) return vMissing("Unknown tag.");
  const ts = readable().filter(t=>t.tags.includes(slug)).sort((a,b)=>lastAt(b)-lastAt(a));
  return crumbs(["Tags"],["#"+tg.name]) + phead("#"+esc(tg.name), esc(tg.desc) + (tg.index?"":" · This tag page is set to noindex.")) + `<section class="panel flush">${topicList(ts)}</section>`;
}

/* ---------- Topic page ---------- */
function renderBody(txt){
  let h = esc(txt);
  h = h.replace(/\[quote=([\w-]+)\]([\s\S]*?)\[\/quote\]/g, (_,u,q) => `<blockquote><cite>${u} wrote:</cite>${q}</blockquote>`);
  h = h.replace(/(^|\s)@([a-z0-9_]+)/gi, (m,s,u) => USERS[u] ? `${s}<a href="#" class="mention" data-go="/members/${u}">@${u}</a>` : m);
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow ugc">$1</a>');
  return h;
}
function roleBadge(name){ const u = USERS[name]; if (!u) return ""; const r = u.role;
  if (["moderator","senior_moderator","admin","super_admin"].includes(r)) return `<span class="pill amber">${esc(roleLabel(r))}</span>`;
  if (r === "business") return `<span class="pill blue">Official rep</span>`;
  if (r === "verified_reviewer" || r === "trusted") return `<span class="pill green">${esc(roleLabel(r))}</span>`;
  if (r === "verified_seller") return sellerBadge(name, true);
  return ""; }
function vTopic(id){
  const t = topic(id); if (!t || t.deleted) return vMissing("That topic was removed or doesn't exist.");
  const b = board(t.board); if (!canReadBoard(b)) return vMissing("You don't have access to this topic.");
  if (CATEGORIES.find(c=>c.id===b.cat)?.gated && gated()) return ageGate();
  if (hiddenTopic(t)) return vMissing("That topic was removed or doesn't exist.");
  if (S.ui.lastTopic !== t.id){ t.views++; S.ui.lastTopic = t.id; }
  if (S.user){ READS[S.user] = READS[S.user] || {}; READS[S.user][t.id] = t.posts.length; }
  const mod = canModBoard(t.board);
  const posts = visiblePosts(t), per = 10, pg = pageOf("t:"+t.id);
  const parent = b.parent ? board(b.parent) : null;
  const following = S.user && FOLLOWS[S.user]?.has("topic:"+t.id);
  const bookmarked = S.user && BOOKMARKS[S.user]?.has(t.id);
  const ev = t.event ? EVENTS.find(e=>e.slug===t.event) : null;
  const chips = [...t.teams.map(s => team(s) && link("/teams/"+s, esc(team(s).name), "pill")), t.league && link("/leagues/"+t.league, esc(league(t.league).name), "pill"), ev && link("/events/"+ev.slug, "Match page", "pill blue"), ev && scoresLink("/match/"+ev.slug, "Live score", "pill blue")].filter(Boolean).join(" ");
  const pollHtml = t.poll ? vPoll(t) : "";
  const unapproved = listingOf(t) && listingOf(t).approval !== "approved";
  const replyBox = unapproved ? `<div class="notice">Replies open once a moderator approves this listing.</div>` : t.locked ? `<div class="notice amber"><strong>Locked.</strong> This topic is closed to new replies.</div>`
    : t.archived ? `<div class="notice"><strong>Archived.</strong> This topic is read-only.</div>`
    : !signedIn() ? `<div class="notice"><span>Sign in to reply.</span><button class="btn small" type="button" data-act="signIn">Sign in</button></div>`
    : !(b.replyRoles || b.postRoles).includes(S.role) || !can("topic") ? `<div class="notice amber">Your role can't reply on this board.</div>`
    : `<form class="panel form" data-form="reply" data-topic="${t.id}">
        <label for="replyBody">Reply</label>${replyHint(t)}<textarea id="replyBody" name="body" placeholder="Use @username to mention someone. Quote a post with the Quote button." required></textarea>
        ${restricted("links")?`<p class="hint" style="margin:0">New member: links are disabled until you reach ${LIMITS.newMemberPostsToGraduate} posts.</p>`:""}
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Post reply</button></div></form>`;
  return crumbs(["Forum","/forum"], ...(parent?[[parent.name,"/forum/"+parent.slug]]:[]), [b.name,"/forum/"+b.slug], [t.title]) +
  `<div class="phead"><div style="min-width:0"><h1 style="font-size:clamp(1.6rem,3.6vw,2.3rem);text-transform:none;line-height:1.1">${esc(t.title)}</h1>
     <div class="meta" style="margin-top:8px">${t.pinned?'<span class="pill solid">Pinned</span>':""}${t.locked?'<span class="pill amber">Locked</span>':""}${t.archived?'<span class="pill">Archived</span>':""}
     <span>Started by ${ulink(t.author)} · ${rel(t.at)}</span><span>${fmt(t.views)} views</span>${t.tags.map(s=>link("/tag/"+s,"#"+esc((TAGS.find(x=>x.slug===s)||{name:s}).name))).join(" ")}</div>
     ${chips?`<div class="row" style="margin-top:8px">${chips}</div>`:""}</div>
   <div class="acts">${signedIn()?`<button class="btn${following?" on":""}" type="button" data-act="follow" data-key="topic:${t.id}">${following?"Following":"Follow"}</button>
     <button class="btn${bookmarked?" on":""}" type="button" data-act="bookmark" data-id="${t.id}">${bookmarked?"Bookmarked":"Bookmark"}</button>`:""}
     ${S.user && can("topic") && !t.locked && !t.poll && !t.listing && !t.review && t.author===S.user?`<button class="btn" type="button" data-act="addPoll" data-id="${t.id}">Add poll</button>`:""}</div></div>
  ${recordHead(t)}
  ${mod ? (() => { const tb = (key, opn, label, cls="") => mp(key, t.board) ? `<button class="btn small ${cls}" type="button" data-act="modTopic" data-op="${opn}" data-id="${t.id}">${label}</button>` : "";
     const btns = tb("topic.pin","pin",t.pinned?"Unpin":"Pin") + tb("topic.lock","lock",t.locked?"Unlock":"Lock") + tb("topic.move","move","Move") + tb("topic.merge","merge","Merge into…")
       + tb("topic.archive","archive",t.archived?"Unarchive":"Archive") + tb("topic.tags","tags","Edit tags") + tb("topic.delete","delete","Delete topic","danger");
     return `<div class="panel tool" style="margin-bottom:14px"><h3 class="ph">Moderator tools · ${esc(b.name)}</h3>${btns ? `<div class="row">${btns}</div>` : `<p class="muted" style="margin:0">Your moderator permissions don't include topic actions on this board.</p>`}</div>`; })() : ""}
  ${pollHtml}
  <section class="panel flush">${posts.slice((pg-1)*per, pg*per).map((p,i) => vPost(t, p, (pg-1)*per+i, mod) + ((pg-1)*per+i === 0 && p === t.posts[0] ? postAd(t) : "")).join("")}</section>
  ${pager(posts.length, per, pg, "t:"+t.id)}
  <div style="margin-top:16px">${replyBox}</div>`;
}
function vPost(t, p, idx, mod){
  const u = USERS[p.author] || {name:p.author, posts:0, rep:{forum:0}};
  const liked = S.user && p.likes.has(S.user);
  const mine = p.author === S.user;
  return `<article class="post${p.hidden?" hidden":""}" id="post-${p.id}">
    <aside>${av(p.author,"md")}${ulink(p.author)} ${roleBadge(p.author)}${postBadge(t,p)}<span class="muted">${esc(rankFor(u.posts))}</span><span class="muted">Forum rep <strong class="num">${fmt(u.rep.forum)}</strong></span><span class="muted">${fmt(u.posts)} posts</span>
      ${signedIn() && !mine && USERS[p.author] ? `<button class="btn small ghost" type="button" data-act="dm" data-user="${esc(p.author)}" style="align-self:flex-start;padding-inline:0">✉ Message</button>`:""}</aside>
    <div class="pb">
      <div class="meta"><span>#${idx+1}</span><span>${dstr(p.at)}</span>${p.revisions.length?`<button class="btn ghost small" type="button" data-act="history" data-topic="${t.id}" data-post="${p.id}">Edited · history</button>`:""}${p.hidden?'<span class="pill red">Hidden by moderator</span>':""}</div>
      <div class="body">${renderBody(p.body)}</div>${postSig(p.author)}
      <div class="pacts">
        <button class="btn small${liked?" on":""}" type="button" data-act="like" data-topic="${t.id}" data-post="${p.id}" ${!signedIn()||mine?"disabled":""} aria-label="Like">▲ ${p.likes.size}</button>
        ${signedIn() && !t.locked ? `<button class="btn small ghost" type="button" data-act="quote" data-topic="${t.id}" data-post="${p.id}">Quote</button><button class="btn small ghost" type="button" data-act="mention" data-user="${esc(p.author)}">Reply</button>`:""}
        ${signedIn() && !mine ? `<button class="btn small ghost" type="button" data-act="report" data-kind="post" data-topic="${t.id}" data-post="${p.id}">Report</button>`:""}
        ${(mine && can("topic")) || (mod && mp("post.edit", t.board)) ? `<button class="btn small ghost" type="button" data-act="editPost" data-topic="${t.id}" data-post="${p.id}">Edit</button>`:""}
        ${mod && mp("post.hide", t.board) ? `<button class="btn small ghost" type="button" data-act="hidePost" data-topic="${t.id}" data-post="${p.id}">${p.hidden?"Unhide":"Hide"}</button>`:""}
        ${mod && idx>0 && mp("topic.merge", t.board) ? `<button class="btn small ghost" type="button" data-act="split" data-topic="${t.id}" data-post="${p.id}">Split from here</button>`:""}
      </div></div></article>`;
}
function vPoll(t){
  const p = t.poll, total = p.options.reduce((n,o)=>n+o.v.size,0);
  const voted = S.user && p.options.some(o=>o.v.has(S.user));
  const closed = Date.now() > p.closes;
  const show = p.publicResults || voted || closed || isStaff();
  return `<section class="panel" style="margin-bottom:14px"><h3 class="ph">Poll · ${p.multi?"pick any":"pick one"} · ${closed?"closed":"closes "+rel(p.closes)}</h3>
    <form data-form="vote" data-topic="${t.id}" class="form" style="gap:8px"><strong>${esc(p.q)}</strong>
    ${p.options.map((o,i) => { const pct = total ? Math.round(o.v.size/total*100) : 0;
      return `<label class="chk" style="display:grid;grid-template-columns:auto minmax(0,1fr) 48px;gap:10px;align-items:center">
        <input type="${p.multi?"checkbox":"radio"}" name="opt" value="${i}" ${o.v.has(S.user)?"checked":""} ${!signedIn()||closed?"disabled":""}>
        <span>${esc(o.t)}${show?`<span class="track" style="display:block;margin-top:4px"><i style="width:${pct}%"></i></span>`:""}</span><span class="num muted">${show?pct+"%":""}</span></label>`; }).join("")}
    <div class="spread"><span class="muted" style="font-size:.85rem">${total} votes${p.publicResults?"":" · results hidden until you vote"}</span>${signedIn()&&!closed?`<button class="btn small" type="submit">${voted?"Change vote":"Vote"}</button>`:""}</div></form></section>`;
}

/* ---------- Sports, leagues, teams ---------- */
const standingsRows = slug => (STANDINGS[slug]||[]).map(r => ({team:r[0],p:r[1],w:r[2],d:r[3],l:r[4],gf:r[5],ga:r[6],pts:r[2]*3+r[3]})).sort((a,b)=>b.pts-a.pts||(b.gf-b.ga)-(a.gf-a.ga));
function standingsTable(slug, hl){
  const rows = standingsRows(slug); if (!rows.length) return '<p class="muted">Standings not available yet.</p>';
  return `<div class="tw"><table class="t"><thead><tr><th class="n">#</th><th>Team</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GD</th><th class="n">Pts</th></tr></thead><tbody>${rows.map((r,i)=>`<tr${r.team===hl?' style="background:var(--turf-soft)"':""}><td class="n">${i+1}</td><td>${link("/teams/"+r.team, esc(team(r.team).name))}</td><td class="n">${r.p}</td><td class="n">${r.w}</td><td class="n">${r.d}</td><td class="n">${r.l}</td><td class="n">${r.gf-r.ga>0?"+":""}${r.gf-r.ga}</td><td class="n"><strong>${r.pts}</strong></td></tr>`).join("")}</tbody></table></div>`;
}
function eventCard(e){
  // Fixture card only. Live scores, stats and results are on the scores site.
  const h = team(e.home), a = team(e.away);
  return `<a class="card" href="#" data-go="/events/${e.slug}"><div class="spread" style="margin-bottom:8px"><span class="muted" style="font-size:.82rem">${esc(league(e.league).name)}</span><span class="pill blue">${dstr(e.at)}</span></div>
    <div class="row">${crest(h,24)}<strong>${esc(h.name)}</strong></div>
    <div class="row" style="margin-top:6px">${crest(a,24)}<strong>${esc(a.name)}</strong></div>
    <div class="muted" style="font-size:.82rem;margin-top:8px">Match thread &amp; predictions</div></a>`;
}
function topicsFor({team:ts, league:ls, tag}){
  return readable().filter(t => (!ts || t.teams.includes(ts)) && (!ls || t.league===ls) && (!tag || t.tags.includes(tag))).sort((a,b)=>lastAt(b)-lastAt(a));
}
/* ---------- Sports, leagues & teams (merged) ---------- */
const sportOf = slug => SPORTS.find(s => s.slug === slug) || {name:slug, slug};
const TYPE_LABEL = {league:"League", tournament:"Tournament", tour:"Tour", promotion:"Promotion", championship:"Championship"};
const leagueCrest = (l, size=44) => l.logo ? `<img class="crest" src="${l.logo}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;background:#fff;border:1px solid var(--line)">`
  : `<span class="crest lcrest" style="width:${size}px;height:${size}px;font-size:${size/3.2}px">${esc(l.name.replace(/[^A-Za-z0-9 ]/g,"").split(" ").filter(w=>w.length>1||/\d/.test(w)).map(w=>w[0]).join("").slice(0,3).toUpperCase())}</span>`;
function leagueCard(l){
  const ts = teamsIn(l.slug), shown = ts.slice(0, 8);
  return `<article class="panel lcard"><div class="row" style="gap:12px;flex-wrap:nowrap;align-items:center">${leagueCrest(l)}
      <div style="min-width:0;flex:1">${link("/leagues/"+l.slug, `<strong style="font-size:1.05rem">${esc(l.name)}</strong>`)}
        <div class="meta" style="margin-top:2px"><span class="pill">${esc(TYPE_LABEL[l.type]||"League")}</span><span>${esc(sportOf(l.sport).name)}</span>${l.country !== l.region ? `<span>${esc(l.country)}</span>` : ""}<span>${esc(l.season)}</span></div></div></div>
    ${ts.length ? `<div class="tchips">${shown.map(t => `<a href="#" data-go="/teams/${t.slug}" class="tchip${LAYOUT.teamBadges ? "" : " nb"}">${crest(t,22)}<span>${esc(t.name)}</span></a>`).join("")}${ts.length > shown.length ? link("/leagues/"+l.slug, `+${ts.length - shown.length} more`, "tchip more") : ""}</div>`
      : `<p class="muted" style="margin:10px 0 0;font-size:.88rem">${l.type==="tour"||l.type==="promotion" ? "Players and fighters are covered in the discussion board." : "No teams added yet."}</p>`}
  </article>`;
}
// One page for every sport, league and team. Filter by sport and by region.
function vSportsHub(sportSlug){
  if (sportSlug !== undefined) S.ui.lgSport = SPORTS.some(s => s.slug === sportSlug) ? sportSlug : "all";
  const region = REGIONS.includes(S.ui.lgRegion) ? S.ui.lgRegion : "all";
  const sport = SPORTS.some(s => s.slug === S.ui.lgSport) ? S.ui.lgSport : "all";
  const list = LEAGUES.filter(l => (region === "all" || l.region === region) && (sport === "all" || l.sport === sport));
  const sportsUsed = SPORTS.filter(s => LEAGUES.some(l => l.sport === s.slug));
  const rchip = (k, label) => `<button type="button" data-act="lgRegion" data-k="${k}" aria-pressed="${region===k}">${label}</button>`;
  const schip = (k, label, n) => `<button type="button" data-act="lgSportChip" data-k="${k}" aria-pressed="${sport===k}">${label}${n!==undefined?` <span class="muted">${n}</span>`:""}</button>`;
  const sp = sport !== "all" ? sportOf(sport) : null;
  const boards = sp ? LEAGUES.filter(l => l.sport === sport).map(l => l.board) : [];
  const topics = sp ? readable().filter(t => boards.includes(t.board) || boards.includes((board(t.board)||{}).parent)).sort((a,b)=>lastAt(b)-lastAt(a)) : [];
  return crumbs(sp ? ["Sports","/sports"] : ["Sports"], ...(sp ? [[sp.name]] : [])) +
    phead(sp ? esc(sp.name) : "Sports", "Every sport, league and team in one place. Pick a sport or a region.", can("manageCategories") ? link("/admin/sports","Add sport, league or team","btn") : "") +
    `<div class="tabs" role="group" aria-label="Sport" style="margin-bottom:8px">${schip("all","All sports")}${sportsUsed.map(s => schip(s.slug, esc(s.name), LEAGUES.filter(l=>l.sport===s.slug).length)).join("")}</div>
    <div class="tabs" role="group" aria-label="Region" style="margin-bottom:16px">${rchip("all","All regions")}${REGIONS.filter(r => LEAGUES.some(l => l.region === r && (sport==="all" || l.sport===sport))).map(r=>rchip(r, r)).join("")}</div>` +
    ((region === "all" ? REGIONS : [region]).map(r => { const ls = list.filter(l => l.region === r); if (!ls.length) return "";
      return `<section style="margin-bottom:22px"><h2 class="sec">${esc(r)}</h2><div class="lgrid">${ls.map(leagueCard).join("")}</div></section>`; }).join("") || `<div class="panel empty">Nothing here yet for that sport and region.</div>`) +
    (sp ? `<section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Latest ${esc(sp.name.toLowerCase())} discussion</h3></div>${topicList(topics.slice(0,15), "No discussion yet for this sport.")}</section>` : "");
}
function vLeague(slug){
  const l = league(slug); if (!l) return vMissing("Unknown league.");
  const tab = S.ui["lt:"+slug] || "overview";
  const fixtures = EVENTS.filter(e=>e.league===slug && e.status==="upcoming").sort((a,b)=>a.at-b.at);
  const fol = S.user && FOLLOWS[S.user]?.has("league:"+slug);
  const tabs = ["overview","teams","fixtures","discussions","predictions","betting"];
  const sections = {
    teams:`<section class="panel"><h3 class="ph">Teams (${teamsIn(slug).length})</h3><div class="grid">${teamsIn(slug).map(t=>`<a class="card" href="#" data-go="/teams/${t.slug}"><div class="row">${crest(t,30)}<strong>${esc(t.name)}</strong></div></a>`).join("")}</div></section>`,
    fixtures:`<section class="panel"><h3 class="ph">Upcoming fixtures</h3>${fixtures.length?`<div class="grid">${fixtures.map(eventCard).join("")}</div>`:'<p class="muted" style="margin:0">No upcoming fixtures.</p>'}</section>`,
    discussions:`<section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Discussions ${link("/forum/"+l.board,"Open board")}</h3></div>${topicList(topicsFor({league:slug}))}</section>`,
    predictions:`<section class="panel"><h3 class="ph">Prediction leaderboard</h3>${predBoard()}</section>`,
    betting:`<section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Betting discussion</h3></div>${topicList(topicsFor({league:slug, tag:"betting"}), "No betting threads yet.")}</section>`
  };
  const body = tab === "overview" ? (teamsIn(slug).length ? sections.teams : "") + sections.discussions + sections.fixtures : sections[tab];
  return crumbs(["Sports","/sports"],[sportOf(l.sport).name,"/sports/"+l.sport],[l.name]) + phead(`<span class="row" style="gap:14px;flex-wrap:nowrap">${leagueCrest(l,52)}<span>${esc(l.name)}</span></span>`, `${esc(TYPE_LABEL[l.type]||"League")} · ${l.country !== l.region ? esc(l.country) + " · " : ""}${esc(l.region)} · Season ${esc(l.season)} · ${link("/sports/"+l.sport, esc(sportOf(l.sport).name))}`,
    scoresLink("/leagues/"+slug, "Table &amp; live scores", "btn") + (signedIn()?`<button class="btn${fol?" on":""}" type="button" data-act="follow" data-key="league:${slug}">${fol?"Following":"Follow league"}</button>`:"")) +
    `<div class="tabs" role="tablist">${tabs.map(x=>`<button type="button" data-act="tab" data-key="lt:${slug}" data-v="${x}" aria-pressed="${tab===x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join("")}</div>
    <div class="cols"><div class="stack">${body}</div><aside class="stack">${scoresPanel("/leagues/"+slug, "Table, results and live scores", `The ${esc(l.name)} table, results, live scores and stats are on our live scores site.`)}</aside></div>`;
}
function predBoard(){
  const rows = Object.entries(PRED_RECORD).map(([u,[w,n]])=>({u,w,n,pct:w/n})).sort((a,b)=>b.pct-a.pct);
  return `<div class="tw"><table class="t"><thead><tr><th>#</th><th>Member</th><th class="n">Correct</th><th class="n">Accuracy</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${ulink(r.u)}</td><td class="n">${r.w}/${r.n}</td><td class="n">${Math.round(r.pct*100)}%</td></tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:.82rem;margin:8px 0 0">Bragging rights only. No money is staked on predictions.</p>`;
}
function vTeam(slug){
  const t = team(slug); if (!t) return vMissing("Unknown team.");
  const l = league(t.league), evs = EVENTS.filter(e=>e.home===slug||e.away===slug);
  const fol = S.user && FOLLOWS[S.user]?.has("team:"+slug);
  const tab = S.ui["tt:"+slug] || "latest";
  const tabMap = {latest:null, transfers:"transfers", "fan talk":"fan-talk", predictions:"predictions", betting:"betting"};
  const ts = topicsFor({team:slug, tag:tabMap[tab]});
  const fans = Object.values(USERS).filter(u=>u.favTeams.includes(slug)).length;
  return crumbs(["Sports","/sports"],[l.name,"/leagues/"+l.slug],[t.name]) +
  `<div class="phead"><div class="ent">${crest(t)}<div><h1>${esc(t.name)}</h1><p>${[t.league, ...(t.also||[])].map(x => league(x)).filter(Boolean).map(x => link("/leagues/"+x.slug, esc(x.name))).join(" · ")} · ${esc(t.country)}</p></div></div>
    <div class="acts">${signedIn()?`<button class="btn${fol?" on":""}" type="button" data-act="follow" data-key="team:${slug}">${fol?"Following":"Follow team"}</button>`:`<button class="btn" type="button" data-act="signIn">Follow team</button>`}
    ${signedIn()&&can("topic")?`<button class="btn primary" type="button" data-act="newTopic" data-board="${l.board}" data-team="${slug}">New topic</button>`:""}</div></div>
  <div class="cols"><div class="stack">
    <section class="panel flush"><div style="padding:14px 16px 0"><div class="tabs" role="tablist">${Object.keys(tabMap).map(x=>`<button type="button" data-act="tab" data-key="tt:${slug}" data-v="${x}" aria-pressed="${tab===x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join("")}</div></div>${topicList(ts, "Nothing here yet. Start the conversation.")}</section>
    <section class="panel"><h3 class="ph">Upcoming fixtures</h3>${evs.filter(e=>e.status==="upcoming").length?`<div class="grid">${evs.filter(e=>e.status==="upcoming").sort((a,b)=>a.at-b.at).map(eventCard).join("")}</div>`:'<p class="muted" style="margin:0">None scheduled.</p>'}</section>
  </div><aside class="stack">
    <section class="panel"><h3 class="ph">Club</h3><dl class="kv"><dt>Country</dt><dd>${esc(t.country)}</dd><dt>League</dt><dd>${link("/leagues/"+l.slug, esc(l.name))}</dd>${t.stadium?`<dt>Ground</dt><dd>${esc(t.stadium)}</dd>`:""}${t.founded?`<dt>Founded</dt><dd class="num">${t.founded}</dd>`:""}<dt>Season</dt><dd>${esc(l.season)}</dd><dt>Fans here</dt><dd class="num">${fmt(fans*1240+87)}</dd></dl></section>
    ${scoresPanel("/teams/"+slug, "Results, table and live scores", `${esc(t.name)}'s results, live scores, position and stats are on our live scores site.`)}
    <section class="panel"><h3 class="ph">Squad (sample)</h3>${PLAYERS.filter(p=>p.team===slug).map(p=>`<div class="spread"><span>${esc(p.name)}</span><span class="muted">${p.pos}</span></div>`).join("")||'<p class="muted" style="margin:0">Player entities are optional in V1.</p>'}</section>
  </aside></div>`;
}
function vEvent(slug){
  const e = EVENTS.find(x=>x.slug===slug); if (!e) return vMissing("Unknown event.");
  const h = team(e.home), a = team(e.away), l = league(e.league);
  const th = e.thread ? topic(e.thread) : null;
  const preds = PREDICTIONS[slug] || {}, mine = S.user && preds[S.user];
  const cnt = {H:0,D:0,A:0}; Object.values(preds).forEach(v=>cnt[v]++); const tot = cnt.H+cnt.D+cnt.A;
  const bet = readable().filter(t=>t.tags.includes("betting") && (t.teams.includes(e.home)||t.teams.includes(e.away)));
  const leadOk = e.status==="upcoming" && (e.at - Date.now()) > SETTINGS.matchThreadLeadHrs*HR;
  return crumbs(["Sports","/sports"],[l.name,"/leagues/"+l.slug],[`${h.name} vs ${a.name}`]) +
  `<section class="panel" style="margin-bottom:16px"><div class="spread" style="margin-bottom:14px;flex-wrap:wrap;gap:8px"><span class="muted">${esc(l.name)} · ${dstr(e.at)} · ${esc(h.stadium)}</span>${scoresLink("/match/"+e.slug, "Live score, stats &amp; lineups", "btn primary small")}</div>
    <div class="scoreline"><div>${crest(h)}<h3>${link("/teams/"+h.slug, esc(h.name))}</h3></div><div class="big">vs</div><div>${crest(a)}<h3>${link("/teams/"+a.slug, esc(a.name))}</h3></div></div></section>
  <div class="cols"><div class="stack">
    <section class="panel"><h3 class="ph">Discussion thread</h3>${th ? `<div class="spread">${link("/topic/"+th.id, `<strong>${esc(th.title)}</strong>`)}<span class="muted">${fmt(th.posts.length-1)} replies</span></div>` :
      `<p class="muted" style="margin:0 0 8px">${leadOk?`A match thread is created automatically ${SETTINGS.matchThreadLeadHrs}h before kickoff.`:"No match thread for this event."}</p>${mp("topic.matchThread", l.board)?`<button class="btn small" type="button" data-act="createMatchThread" data-slug="${slug}">Create match thread now</button>`:""}`}</section>
    <section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Betting discussion</h3></div>${topicList(bet,"No betting threads for this match.")}</section>
  </div><aside class="stack">
    <section class="panel"><h3 class="ph">Predictions</h3>
      ${["H","D","A"].map(k=>{const lab = k==="H"?h.name:k==="A"?a.name:"Draw", pct = tot?Math.round(cnt[k]/tot*100):0;
        return `<div style="margin-bottom:8px"><div class="spread"><span>${esc(lab)}${mine===k?' <span class="pill green">Your pick</span>':""}</span><span class="num muted">${pct}%</span></div><div class="track"><i style="width:${pct}%"></i></div></div>`;}).join("")}
      <p class="muted" style="font-size:.85rem;margin:4px 0 10px">${tot} predictions · no money involved</p>
      ${e.status==="upcoming" ? (signedIn()?`<div class="row">${["H","D","A"].map(k=>`<button class="btn small${mine===k?" on":""}" type="button" data-act="predict" data-slug="${slug}" data-v="${k}">${k==="H"?esc(h.short):k==="A"?esc(a.short):"Draw"}</button>`).join("")}</div>`:`<button class="btn small" type="button" data-act="signIn">Sign in to predict</button>`) : '<p class="muted" style="margin:0;font-size:.85rem">Predictions closed at kickoff.</p>'}
    </section>
    <section class="panel"><h3 class="ph">Related</h3><div class="stack" style="gap:6px">${link("/teams/"+h.slug, esc(h.name))}${link("/teams/"+a.slug, esc(a.name))}${link("/leagues/"+l.slug, esc(l.name))}</div></section>
  </aside></div>`;
}
function vLive(){
  // Old /live links land here. Live scores are on the separate scores site.
  return `<section class="panel" style="max-width:560px;margin:30px auto;text-align:center"><h2 class="sec">Live scores have their own site</h2>
    <p>Scores, fixtures, tables and match stats are on our live scores site, so the forum stays quick. Match threads and predictions stay here.</p>
    <div class="row" style="justify-content:center">${scoresLink("", "Open live scores", "btn primary")}${link("/leagues","Browse leagues","btn")}</div></section>`;
}
function vMissing(msg){ return `<div class="panel empty" style="margin-top:20px"><h2 class="sec">Not here</h2><p>${esc(msg)}</p>${link("/","Back to home","btn")}</div>`; }
/* =====================================================================
   VIEWS B: gambling, reviews directory, operators, complaints,
   marketplace, members, profiles, search, notifications
   ===================================================================== */
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;

/* Rating integrity model (§13): weighted, not a plain average */
function trust(o){
  const rs = REVIEWS.filter(r=>r.op===o.slug && r.status!=="removed");
  const cs = COMPLAINTS.filter(c=>c.op===o.slug);
  if (!rs.length) return {score:0, parts:{}, n:0, avg:0, flags:[]};
  const avg = mean(rs.map(r=>r.stars));
  const parts = {
    reviews: (avg-1)/4*100,
    quality: mean(rs.map(r=>{ const t = r.helpful.size + r.unhelpful.size; return t ? r.helpful.size/t : .5; }))*100,
    verified: rs.filter(r=>r.status.startsWith("verified")).length/rs.length*100,
    resolution: cs.length ? (cs.filter(c=>c.status==="Resolved").length + .5*cs.filter(c=>c.status==="Partially Resolved").length)/cs.length*100 : 100,
    recency: rs.filter(r=>Date.now()-r.at < 90*DAY).length/rs.length*100,
    community: mean(rs.map(r=>Math.min(1, ((USERS[r.user]||{rep:{forum:0}}).rep.forum)/500)))*100
  };
  const wsum = Object.values(WEIGHTS).reduce((a,b)=>a+b,0) || 1;
  const score = Object.keys(WEIGHTS).reduce((n,k)=>n + parts[k]*WEIGHTS[k], 0)/wsum/10;
  const flags = [];
  const recentLow = rs.filter(r=>Date.now()-r.at < 2*DAY && r.stars===1).length;
  if (recentLow >= 3) flags.push("Possible review bombing: 3+ one-star reviews in 48h");
  const bodies = rs.map(r=>r.body.toLowerCase()); if (new Set(bodies).size < bodies.length) flags.push("Duplicate review text detected");
  if (rs.some(r=>o.reps.includes(r.user))) flags.push("Self-review by an operator representative");
  return {score, parts, n:rs.length, avg, flags};
}
const complaintCounts = slug => { const cs = COMPLAINTS.filter(c=>c.op===slug);
  return {total:cs.length, resolved:cs.filter(c=>c.status==="Resolved").length, partial:cs.filter(c=>c.status==="Partially Resolved").length,
    unresolved:cs.filter(c=>c.status==="Unresolved"||c.status==="No Response").length, rejected:cs.filter(c=>c.status==="Rejected").length,
    open:cs.filter(c=>OPEN_STATUSES.includes(c.status)).length}; };
const statusPill = s => { const m = {Resolved:"green","Partially Resolved":"amber",Unresolved:"red","No Response":"red",Rejected:"",Escalated:"red",Closed:"",
  "Under Investigation":"blue","Awaiting Business":"amber","Awaiting User":"amber",Open:"blue",
  "verified transaction":"solid","verified user":"green",unverified:"",disputed:"amber",removed:"red",Available:"green",Pending:"amber",Sold:""};
  return `<span class="pill ${m[s]||""}">${esc(STATUS_LABEL[s]||s)}</span>`; };
const warnBadge = o => o.warning ? (o.warning.status==="confirmed" ? '<span class="pill red">Confirmed: scam finding</span>' : '<span class="pill amber">Allegation open</span>') : "";
const commercialBadge = o => o.affiliate ? '<span class="pill blue" title="Pitchside earns a commission from this operator">Affiliate partner</span>' : "";

function ageGate(next){
  return `<section class="panel" style="max-width:560px;margin:30px auto;text-align:center"><h2 class="sec">18+ only</h2>
    <p>Gambling discussion and operator reviews are for adults. Please confirm you're old enough to view gambling content where you live.</p>
    <div class="row" style="justify-content:center"><button class="btn primary" type="button" data-act="ageOk">I'm 18 or older</button>${link("/","Take me back","btn")}</div>
    <p class="muted" style="font-size:.85rem;margin-top:14px">Age and geo restrictions are configurable per jurisdiction in Admin → System.</p></section>`;
}
const gated = () => SETTINGS.ageGate && !S.ageOk;

const GSEC_SHORT = {"sports-betting":"Sports Betting", racing:"Racing", casino:"Casino", poker:"Poker", sportsbooks:"Sportsbooks", bonuses:"Bonuses", exchanges:"Exchanges", fantasy:"Fantasy", "lottery-bingo":"Lottery & Bingo", sweepstakes:"Sweepstakes", "gambling-strategy":"Strategy"};
function vGambling(){
  if (gated()) return ageGate();
  // Discussion only. Reviews live under Gambling → Reviews / Casinos & Sportsbooks.
  const talk = BOARDS.filter(b => b.cat === "gambling" && !b.kind && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
  const filter = talk.some(b => b.slug === S.ui.gSec) ? S.ui.gSec : "all";
  const pick = filter === "all" ? talk : talk.filter(b => b.slug === filter);
  const ids = BOARDS.filter(b => pick.some(p => p.slug === b.slug || p.slug === b.parent)).map(b=>b.slug);
  // Complaint discussions only show here once someone has replied.
  const ts = readable().filter(t => ids.includes(t.board) && (!t.complaint || t.posts.length > 1)).sort((a,b)=>(b.pinned-a.pinned)||(lastAt(b)-lastAt(a)));
  const per = 15, p = pageOf("gambling");
  const postBoard = filter !== "all" && !board(filter).replyRoles ? ` data-board="${filter}"` : "";
  const post = signedIn() ? `<button class="btn small primary" type="button" data-act="newTopic" data-cat="gambling"${postBoard}>New topic</button>` : `<button class="btn small" type="button" data-act="signIn">Sign in to post</button>`;
  const main = ["sports-betting","racing","casino","poker","sportsbooks","bonuses","exchanges","fantasy","lottery-bingo","sweepstakes","gambling-strategy"].map(board).filter(b => b && canReadBoard(b));
  const chip = (k, label) => `<button type="button" data-act="gSec" data-k="${k}" aria-pressed="${filter===k}">${label}</button>`;
  return `<div class="tabs" role="group" aria-label="Filter by section" style="margin-bottom:14px">${chip("all","All")}${main.map(b=>chip(b.slug, esc(GSEC_SHORT[b.slug] || b.name))).join("")}</div>
  <div class="cols"><div class="stack"><section class="panel flush"><div class="spread" style="padding:14px 16px 0;gap:8px"><h3 class="ph" style="margin:0">${filter==="all" ? "Latest topics" : "Latest in " + esc(board(filter).name)}</h3>${post}</div>
        ${topicList(ts.slice((p-1)*per, p*per), "No topics here yet. Start the first one.")}</section>${pager(ts.length, per, p, "gambling")}</div>
    <aside class="stack"><section class="panel"><h3 class="ph">Sections</h3>${talk.map(b=>{ const st = boardStats(b), subs = BOARDS.filter(x=>x.parent===b.slug && canReadBoard(x)).sort((a,c)=>a.order-c.order);
      return `<div style="padding:7px 0;border-top:1px solid var(--line)"><div class="spread">${link("/forum/"+b.slug, `<strong>${esc(b.name)}</strong>`)}<span class="muted" style="font-size:.82rem;white-space:nowrap">${fmt(st.topics)} topic${st.topics===1?"":"s"}</span></div><div class="muted" style="font-size:.86rem">${esc(b.desc)}</div>
        ${subs.length ? `<div class="meta" style="margin-top:3px;flex-wrap:wrap">${subs.map(x=>link("/forum/"+x.slug, esc(x.name))).join(" · ")}</div>` : ""}</div>`; }).join("")}</section></aside></div>`;
}

/* ---------- Community: clean page, latest topics + boards ---------- */
function vCommunity(){
  const boards = BOARDS.filter(b => b.cat === "community" && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
  const ids = BOARDS.filter(b => b.cat === "community").map(b => b.slug);
  const ts = readable().filter(t => ids.includes(t.board)).sort((a,b)=>(b.pinned-a.pinned)||(lastAt(b)-lastAt(a)));
  const per = 15, p = pageOf("community");
  const post = signedIn() ? `<button class="btn small primary" type="button" data-act="newTopic" data-cat="community" data-board="general">New topic</button>` : `<button class="btn small" type="button" data-act="signIn">Sign in to post</button>`;
  return `<div class="cols"><div class="stack"><section class="panel flush"><div class="spread" style="padding:14px 16px 0;gap:8px"><h3 class="ph" style="margin:0">Latest in Community</h3>${post}</div>
      ${topicList(ts.slice((p-1)*per, p*per), "No topics here yet. Start the first one.")}</section>${pager(ts.length, per, p, "community")}</div>
    <aside class="stack"><section class="panel"><h3 class="ph">Boards</h3>${boards.map(b => { const st = boardStats(b);
      return `<div style="padding:7px 0;border-top:1px solid var(--line)"><div class="spread">${link("/forum/"+b.slug, `<strong>${esc(b.name)}</strong>`)}<span class="muted" style="font-size:.82rem;white-space:nowrap">${fmt(st.topics)} topic${st.topics===1?"":"s"}</span></div><div class="muted" style="font-size:.86rem">${esc(b.desc)}</div></div>`; }).join("")}</section>
      <section class="panel"><h3 class="ph">Members</h3><p style="margin:0 0 8px;font-size:.92rem" class="muted">Find people, see who's online and who moderates what.</p>${link("/members","Browse members")} · ${link("/staff","Contact staff")}</section></aside></div>`;
}

/* ---------- Crypto: clean page, latest topics + one board per coin ---------- */
function vCrypto(){
  const boards = BOARDS.filter(b => b.cat === "crypto" && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
  const filter = S.ui.cBoard || "all";
  const ids = BOARDS.filter(b => b.cat === "crypto" && (filter === "all" || b.slug === filter || b.parent === filter)).map(b=>b.slug);
  const ts = readable().filter(t => ids.includes(t.board)).sort((a,b)=>(b.pinned-a.pinned)||(lastAt(b)-lastAt(a)));
  const per = 15, p = pageOf("crypto");
  const post = signedIn() ? `<button class="btn small primary" type="button" data-act="newTopic" data-cat="crypto"${filter!=="all"?` data-board="${filter}"`:""}>New topic</button>` : `<button class="btn small" type="button" data-act="signIn">Sign in to post</button>`;
  const chip = (k, label) => `<button type="button" data-act="cBoard" data-k="${k}" aria-pressed="${filter===k}">${label}</button>`;
  return `<div class="tabs" role="group" aria-label="Filter by coin" style="margin-bottom:14px">${chip("all","All")}${boards.filter(b=>b.coin).map(b=>chip(b.slug, b.coin === "USD" ? "Stablecoins" : esc(b.coin))).join("")}</div>
  <div class="cols"><div class="stack"><section class="panel flush"><div class="spread" style="padding:14px 16px 0;gap:8px"><h3 class="ph" style="margin:0">${filter==="all" ? "Latest topics" : "Latest in " + esc(board(filter).name)}</h3>${post}</div>
      ${topicList(ts.slice((p-1)*per, p*per), "No topics here yet. Start the first one.")}</section>${pager(ts.length, per, p, "crypto")}</div>
    <aside class="stack"><section class="panel"><h3 class="ph">Boards</h3>${boards.map(b => { const st = boardStats(b), subs = BOARDS.filter(x=>x.parent===b.slug && canReadBoard(x));
      return `<div style="padding:7px 0;border-top:1px solid var(--line)"><div class="spread"><span class="row" style="gap:8px;flex-wrap:nowrap;min-width:0">${b.coin && b.coin !== "USD" ? `<span class="coin">${esc(b.coin)}</span>` : b.coin ? '<span class="coin">$</span>' : ""}${link("/forum/"+b.slug, `<strong>${esc(b.name)}</strong>`)}</span><span class="muted" style="font-size:.82rem;white-space:nowrap">${fmt(st.topics)} topic${st.topics===1?"":"s"}</span></div>
        <div class="muted" style="font-size:.86rem">${esc(b.desc)}</div>${subs.length ? `<div class="meta" style="margin-top:2px">${subs.map(x=>link("/forum/"+x.slug, esc(x.name))).join(" · ")}</div>` : ""}</div>`; }).join("")}</section></aside></div>`;
}

/* ---------- Forum helpers for review and listing topics ---------- */
function kindButton(b){
  if (!signedIn()) return `<button class="btn" type="button" data-act="signIn">Sign in to post</button>`;
  if (b.kind === "review") return can("review") && S.role !== "business" ? `<button class="btn primary" type="button" data-act="writeReview"${b.opType?` data-type="${b.opType}"`:""}>Post a review</button>` : "";
  if (b.kind === "listing") return can("listing") ? `<button class="btn primary" type="button" data-act="newListing"${b.mcat?` data-cat="${esc(b.mcat)}"`:""}>Post a listing</button>` : "";
  return "";
}
function kindNotice(b){
  if (b.kind === "review") return `<div class="notice" style="margin-bottom:12px">Each topic is one member's review. Its rating feeds the operator's trust score. One review per operator every 180 days.</div>`;
  if (b.kind === "listing") return `<div class="notice amber" style="margin-bottom:12px"><strong>Pay safely.</strong><span>Listings marked 🔒 Escrow can be paid in USDT or USDC through an escrow contract, so the other person is paid only when you confirm delivery. A moderator checks every new listing before it appears. Without escrow you pay people directly, so check their marketplace feedback first, and keep questions in the topic so everyone can see the answers.</span></div>`;
  return "";
}
function topicExtras(t){
  if (t.review){ const r = REVIEWS.find(x=>x.id===t.review); if (!r) return ""; const o = op(r.op);
    return `<span class="stars" title="${r.stars} of 5">${stars(r.stars)}</span>${link(opPath(o), esc(o.name), "pill")}${r.status!=="unverified"?statusPill(r.status):""}`; }
  if (t.complaint){ const c = COMPLAINTS.find(x=>x.id===t.complaint); if (!c) return "";
    return `<span class="pill">${esc(c.id)}</span>${link(opPath(op(c.op)), esc(op(c.op).name), "pill")}${statusPill(c.status)}`; }
  if (t.listing){ const l = LISTINGS.find(x=>x.id===t.listing); if (!l) return "";
    return `<strong style="color:var(--fg)">${esc(l.price)}</strong>${l.approval==="pending"?'<span class="pill amber">Awaiting approval</span>':l.approval==="rejected"?'<span class="pill red">Not approved</span>':statusPill(l.status)}${l.featured?'<span class="pill blue">Featured</span>':""}${l.escrow && escrowCheck(l).ok ? '<span class="pill blue">🔒 Escrow</span>' : ""}${sellerBadge(l.seller, true)}`; }
  return "";
}
function postBadge(t, p){
  if (t.complaint){ const c = COMPLAINTS.find(x=>x.id===t.complaint); if (!c) return "";
    if (p.author === c.user) return '<span class="pill">Complainant</span>';
    if (op(c.op).reps.includes(p.author)) return `<span class="pill blue">${esc(op(c.op).name)} rep</span>`;
    return ""; }
  if (t.review){ const o = op(REVIEWS.find(r=>r.id===t.review).op);
    if (o.reps.includes(p.author)) return `<span class="pill blue">Official ${esc(o.name)} response</span>`;
    if (p.author === t.author) return '<span class="pill">Reviewer</span>'; }
  if (t.listing && p.author === t.author) return '<span class="pill green" title="Posted this listing">OP</span>' + (USERS[p.author] && USERS[p.author].role !== "verified_seller" ? sellerBadge(p.author, true) : "");
  return "";
}
function replyHint(t){
  if (t.review){ const o = op(REVIEWS.find(r=>r.id===t.review).op); if (isRep(o.slug)) return `<span class="hint">You're replying as ${esc(o.name)}'s official representative. Your reply is labelled as an official response.</span>`; }
  if (t.listing && t.author !== S.user) return `<span class="hint">Questions about the item go here so everyone sees the answer. Message them directly for price or delivery details.</span>`;
  return "";
}
// Structured header shown above the first post of a review or listing topic
function recordHead(t){
  if (t.complaint){ const c = COMPLAINTS.find(x=>x.id===t.complaint); if (!c) return ""; const o = op(c.op);
    return `<section class="panel" style="margin-bottom:14px">
      <div class="spread" style="gap:12px;flex-wrap:wrap"><div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0">${opCrest(o,44)}<div style="min-width:0"><strong>Complaint ${esc(c.id)} against ${link(opPath(o), esc(o.name))}</strong>
        <div class="meta" style="margin-top:3px">${statusPill(c.status)}<span>${esc(c.cat)}</span>${c.amount?`<span>${money(c.amount)}</span>`:""}<span>Filed by ${ulink(c.user)}</span></div></div></div>
        ${link("/complaints/"+c.id, "Open the official case", "btn primary small")}</div>
      <div class="notice" style="margin:12px 0 0"><strong>Community discussion.</strong><span>Any member can share experiences or advice here. It isn't part of the case: specialists decide on what the player and ${esc(o.name)} say in the official case thread. Don't post personal details or account numbers.</span></div></section>`; }
  if (t.review){
    const r = REVIEWS.find(x=>x.id===t.review), o = op(r.op), mine = r.user === S.user, rep = isRep(o.slug), tr = trust(o);
    const vote = S.user ? (r.helpful.has(S.user) ? "up" : r.unhelpful.has(S.user) ? "down" : null) : null;
    return `<section class="panel" style="margin-bottom:14px">
      <div class="spread"><div class="row"><span class="crest" style="background:${o.color};width:40px;height:40px;font-size:.85rem;border-radius:10px">${esc(o.name.split(" ").map(w=>w[0]).join("").slice(0,3))}</span>
        <div>${link(opPath(o), `<strong>${esc(o.name)}</strong>`)} <span class="muted" style="font-size:.88rem">${o.type}</span> ${warnBadge(o)}<div class="muted" style="font-size:.85rem">Trust score ${tr.n?tr.score.toFixed(1):"—"}/10 · ${tr.n} reviews</div></div></div>
        <div style="text-align:right"><div class="stars" style="font-size:1.35rem" title="${r.stars} of 5">${stars(r.stars)}</div>${statusPill(r.status)}</div></div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600;font-size:.92rem">Category scores</summary>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:4px 20px;margin-top:8px">${REVIEW_CATS.map(k=>`<div class="bar2" style="grid-template-columns:92px minmax(0,1fr) 22px;margin:0"><span>${k}</span><div class="track"><i style="width:${r.scores[k]/5*100}%"></i></div><span class="num">${r.scores[k]}</span></div>`).join("")}</div></details>
      <div class="row" style="margin-top:12px">
        <span class="muted" style="font-size:.88rem">Was this review helpful?</span>
        <button class="btn small${vote==="up"?" on":""}" type="button" data-act="rvote" data-id="${r.id}" data-v="up" ${!signedIn()||mine?"disabled":""}>Yes · ${r.helpful.size}</button>
        <button class="btn small${vote==="down"?" on":""}" type="button" data-act="rvote" data-id="${r.id}" data-v="down" ${!signedIn()||mine?"disabled":""}>No · ${r.unhelpful.size}</button>
        ${mine && r.status!=="removed" ? `<button class="btn small ghost" type="button" data-act="editReview" data-id="${r.id}">Edit rating</button>`:""}
        ${r.history.length ? `<button class="btn small ghost" type="button" data-act="reviewHistory" data-id="${r.id}">Edit history</button>`:""}
        ${rep && r.status!=="disputed" ? `<button class="btn small" type="button" data-act="disputeReview" data-id="${r.id}">Dispute this review</button>`:""}
        ${mp("review.moderate") ? `<button class="btn small" type="button" data-act="reviewStatus" data-id="${r.id}">Set status</button>`:""}
      </div>
      ${r.status==="removed" ? `<div class="notice red" style="margin-top:10px">Removed by moderators. Only you and staff can see it, and it no longer counts toward the trust score.</div>`:""}
      ${rep ? `<p class="muted" style="font-size:.83rem;margin:10px 0 0">As the business you can reply below and dispute, but you can't edit or remove reviews.</p>`:""}
    </section>`;
  }
  if (t.listing){
    const l = LISTINGS.find(x=>x.id===t.listing), s = USERS[l.seller], ss = sellerStats(l.seller), mine = l.seller === S.user;
    const gaveFb = S.user && l.feedback.some(f=>f.from===S.user);
    const live = l.approval === "approved", approver = mp("queue.listings");
    const gate = l.approval === "pending"
      ? `<div class="notice amber" style="margin-bottom:14px"><strong>Awaiting approval.</strong><span>${mine ? "A moderator checks every listing before it goes live, usually within a few hours. Only you and moderators can see it until then." : "Only the person who posted it and moderators can see this listing until it's approved."}</span>${approver ? `<span class="row" style="margin-left:auto"><button class="btn small primary" type="button" data-act="approveListing" data-id="${l.id}">Approve</button><button class="btn small" type="button" data-act="rejectListing" data-id="${l.id}">Reject</button></span>` : ""}</div>`
      : l.approval === "rejected"
      ? `<div class="notice red" style="margin-bottom:14px"><strong>Not approved.</strong><span>${esc(l.rejectReason || "This listing breaks the marketplace rules.")}${mine ? " Edit the description to fix it and it goes back for approval." : ""}</span>${mine ? `<button class="btn small" type="button" data-act="editPost" data-topic="${t.id}" data-post="${t.posts[0].id}" style="margin-left:auto">Edit and resubmit</button>` : approver ? `<button class="btn small primary" type="button" data-act="approveListing" data-id="${l.id}" style="margin-left:auto">Approve anyway</button>` : ""}</div>`
      : "";
    return gate + escrowListingBlock(l, t) + `<section class="panel" style="margin-bottom:14px">
      <div class="spread"><div><div class="score" style="font-size:1.8rem">${esc(l.price)}</div>
        <div class="meta" style="margin-top:4px">${link("/forum/"+MARKET_BOARD[l.cat], esc(l.cat))}${statusPill(l.status)}${l.featured?'<span class="pill blue">Featured · paid placement</span>':""}${l.removed?'<span class="pill red">Removed</span>':""}</div></div>
        <div style="text-align:right;font-size:.92rem"><div>Posted by ${ulink(l.seller)} ${sellerBadge(l.seller, true) || ""}</div>${isVerifiedSeller(l.seller) ? "" : `<div class="muted" style="font-size:.82rem">Not verified</div>`}<div class="muted">Marketplace rep ${fmt(s?s.rep.market:0)} · ${ss.n?`<span class="stars">${stars(ss.avg)}</span> from ${ss.n} trades`:"no feedback yet"}</div></div></div>
      <div class="row" style="margin-top:12px">
        ${!live && !mine ? "" : mine ? `<span class="muted" style="font-size:.88rem">Status</span>${["Available","Pending","Sold"].map(x=>`<button class="btn small${l.status===x?" on":""}" type="button" data-act="listingStatus" data-id="${l.id}" data-v="${x}">${x}</button>`).join("")}${live&&!l.featured&&!l.featureReq?`<button class="btn small ghost" type="button" data-act="featureReq" data-id="${l.id}">Request featured placement</button>`:""}`
          : signedIn() ? `<button class="btn small primary" type="button" data-act="dm" data-user="${esc(l.seller)}" data-ref="${esc(l.title)}">Message ${esc(l.seller)}</button>
            ${l.status==="Sold" && !gaveFb ? `<button class="btn small" type="button" data-act="leaveFeedback" data-id="${l.id}">Leave feedback</button>`:""}
            <button class="btn small" type="button" data-act="dispute" data-id="${l.id}">Open a dispute</button><button class="btn small ghost" type="button" data-act="report" data-kind="listing" data-id="${l.id}">Report listing</button>`
          : `<button class="btn small" type="button" data-act="signIn">Sign in to message them</button>`}
        ${mp("listing.remove") ? `<button class="btn small danger" type="button" data-act="removeListing" data-id="${l.id}">${l.removed?"Restore listing":"Remove listing"}</button>`:""}
      </div>
      ${l.feedback.length ? `<div style="margin-top:12px">${l.feedback.map(f=>`<div style="font-size:.92rem"><span class="stars">${stars(f.stars)}</span> ${ulink(f.from)} <span class="muted">${rel(f.at)}</span> · ${esc(f.text)}</div>`).join("")}</div>`:""}
    </section>`;
  }
  return "";
}

/* ---------- Marketplace (forum style) ----------
   Listings are topics on category boards; this page is their index. */
function vMarket(qs){
  if (qs.cat && MARKET_BOARD[qs.cat]) return vBoard(MARKET_BOARD[qs.cat]);
  const boards = BOARDS.filter(b=>b.cat==="market" && !b.parent && canReadBoard(b)).sort((a,b)=>a.order-b.order);
  const ts = readable().filter(t=>t.listing && (!S.ui.verOnly || isVerifiedSeller(t.author))).sort((a,b)=>lastAt(b)-lastAt(a));
  const featured = ts.filter(t=>LISTINGS.find(l=>l.id===t.listing).featured);
  return crumbs(["Marketplace"]) + phead("Marketplace", "Swap services, tickets, memorabilia and other things with members. Every listing is a topic, so questions and answers stay public.", kindButton({kind:"listing"})) +
    kindNotice({kind:"listing"}) +
    `<div class="cols"><div class="stack">
      <section class="panel flush">${boardRows(boards)}</section>
      <section class="panel flush"><div class="spread" style="padding:14px 16px 0"><h3 class="ph" style="margin:0">Latest listings</h3><label class="row" style="gap:6px;font-size:.92rem;margin-bottom:10px"><input type="checkbox" id="verOnly" data-act="verOnly" ${S.ui.verOnly?"checked":""}> Verified members only</label></div>${topicList(ts, S.ui.verOnly ? "No listings from verified members yet." : "No listings yet.")}</section>
    </div><aside class="stack">
      ${(() => { const mine = S.user ? LISTINGS.filter(l=>l.seller===S.user && l.approval!=="approved") : [];
        return mine.length ? `<section class="panel"><h3 class="ph">Your listings awaiting approval</h3>${mine.map(l=>`<div style="padding:6px 0;border-top:1px solid var(--line)">${link("/topic/"+l.thread, esc(l.title))}<div style="margin-top:3px">${l.approval==="pending"?'<span class="pill amber">Awaiting approval</span>':'<span class="pill red">Not approved</span>'}</div></div>`).join("")}</section>` : ""; })()}
      ${mp("queue.listings") ? (() => { const n = LISTINGS.filter(l=>l.approval==="pending").length; return `<section class="panel tool"><h3 class="ph">Listing approvals</h3><p style="margin:0 0 8px">${n ? `${n} listing${n>1?"s":""} waiting for approval.` : "Nothing waiting."}</p>${n?`<button class="btn small" type="button" data-act="openApprovals">Open the queue</button>`:""}</section>`; })() : ""}
      ${featured.length?`<section class="panel"><h3 class="ph">Featured · paid placements</h3>${featured.map(t=>{ const l = LISTINGS.find(x=>x.id===t.listing); return `<div style="padding:6px 0;border-top:1px solid var(--line)">${link("/topic/"+t.id, esc(t.title))}<div class="muted" style="font-size:.88rem">${esc(l.price)}</div></div>`; }).join("")}</section>`:""}
      <section class="panel"><h3 class="ph">How deals work here</h3><ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:.93rem">
        <li>Ask questions in the listing topic.</li><li>Check their marketplace feedback, which is separate from forum reputation.</li>
        <li>Agree the details by message.</li><li>Use <strong>Pay with escrow</strong> on 🔒 listings: your USDT or USDC is locked until you confirm delivery.</li><li>Without escrow you pay them directly, at your own risk.</li><li>Leave feedback once it's done, or open a dispute.</li></ol>${link("/page/escrow","How escrow works")}</section>
      ${signedIn() && !isVerifiedSeller(S.user) ? `<section class="panel"><h3 class="ph">Get the ✓ Verified badge</h3><p style="margin:0 0 10px;font-size:.92rem">${me().sellerVerif.status === "pending" ? "Your verification is under review." : "Verified members show others they're real and accountable. Free, about five minutes."}</p>${link("/get-verified", me().sellerVerif.status === "pending" ? "Check status" : "Get verified", "btn small")}</section>` : ""}
      ${signedIn() ? (() => { const mine = ESCROWS.filter(e => (e.buyer === S.user || e.seller === S.user) && ESCROW_OPEN.includes(e.status));
        return `<section class="panel"><h3 class="ph">Your escrow deals ${link("/escrow","All")}</h3>${mine.length ? mine.map(e=>`<div style="padding:6px 0;border-top:1px solid var(--line)">${link("/escrow/"+e.id, esc((LISTINGS.find(l=>l.id===e.listing)||{title:e.id}).title))}<div class="meta" style="margin-top:3px">${escrowPill(e)}<span>${usd(e.amount)} ${e.token}</span><span>${e.buyer===S.user?"paying":"getting paid"}</span></div></div>`).join("") : '<p class="muted" style="margin:0;font-size:.9rem">No open deals.</p>'}</section>`; })() : ""}
    </aside></div>`;
}
function sellerStats(name){ const all = SELLER_FEEDBACK[name] || []; return {n:all.length, avg:mean(all)}; }
function vListing(id){ const l = LISTINGS.find(x=>x.id===+id); return l && l.thread ? vTopic(l.thread) : vMissing("That listing was removed or doesn't exist."); }

/* ---------- Members & profiles ---------- */
function vMembers(){
  const q = (S.ui.memq||"").toLowerCase(), sort = S.ui.mems || "forum";
  const list = Object.values(USERS).filter(u=>!q||u.name.includes(q)).sort((a,b)=>sort==="joined"?a.joined-b.joined:sort==="posts"?b.posts-a.posts:(b.rep[sort]||0)-(a.rep[sort]||0));
  return crumbs(["Members"]) + phead("Members", "Reputation is split into forum, marketplace, review and prediction so one number can't hide a bad record.", link("/staff","Staff directory","btn")) +
    `<div class="row" style="margin-bottom:12px"><input class="inp" style="flex:1 1 200px;width:auto" type="search" placeholder="Find a member" value="${esc(S.ui.memq||"")}" data-input="memq" id="memq">
     <div class="tabs" style="margin:0">${[["forum","Forum rep"],["market","Market rep"],["review","Review rep"],["posts","Posts"],["joined","Oldest"]].map(([v,t])=>`<button type="button" data-act="ui" data-k="mems" data-v="${v}" aria-pressed="${sort===v}">${t}</button>`).join("")}</div></div>
    <section class="panel flush"><div class="tw"><table class="t"><thead><tr><th>Member</th><th>Rank</th><th class="n">Forum</th><th class="n">Market</th><th class="n">Review</th><th class="n">Posts</th><th class="n">Joined</th><th></th></tr></thead><tbody>
    ${list.map(u=>`<tr><td><span class="row">${av(u.name)}${ulink(u.name)}${roleBadge(u.name)}${u.status!=="active"?`<span class="pill red">${esc(u.status)}</span>`:""}</span></td><td>${esc(rankFor(u.posts))}</td><td class="n">${fmt(u.rep.forum)}</td><td class="n">${fmt(u.rep.market)}</td><td class="n">${fmt(u.rep.review)}</td><td class="n">${fmt(u.posts)}</td><td class="n">${dday(u.joined)}</td><td class="n">${signedIn() && u.name !== S.user ? `<button class="btn small ghost" type="button" data-act="dm" data-user="${esc(u.name)}">Message</button>`:""}</td></tr>`).join("")}</tbody></table></div></section>`;
}
/* Who may message whom.
   - Members message each other unless blocked, the recipient turned DMs off, or a New Member hit the daily limit.
   - Anyone signed in can always reach staff, even suspended members and New Members over their limit.
   - Staff can message any member; reaching someone who turned DMs off needs the dm.anyone moderator permission. */
function dmCheck(target){
  if (!signedIn()) return {ok:false, why:"Sign in to send messages."};
  if (target === S.user) return {ok:false, why:"That's you."};
  const t = USERS[target]; if (!t) return {ok:false, why:"That member doesn't exist."};
  const toStaff = isStaffUser(target), fromStaff = isStaff();
  if (!can("pm") && !toStaff) return {ok:false, why: me().status !== "active" ? `Your account is ${me().status}. You can still message moderators and admins.` : `${roleLabel(S.role)} accounts can't message other members. You can still message moderators and admins.`};
  if (BLOCKS[S.user]?.has(target)) return {ok:false, why:`You blocked ${target}. Unblock them to send messages.`};
  if (BLOCKS[target]?.has(S.user) && !fromStaff) return {ok:false, why:`${target} isn't accepting messages from you.`};
  if (!fromStaff && !toStaff){
    if (t.privacy.dms === "nobody") return {ok:false, why:`${target} has turned off private messages.`};
    if (t.privacy.dms === "staff") return {ok:false, why:`${target} only accepts messages from moderators and admins.`};
    if (t.status !== "active") return {ok:false, why:`${target}'s account is ${t.status}.`};
  }
  if (fromStaff && !toStaff && t.privacy.dms !== "members" && !mp("dm.anyone")) return {ok:false, why:`${target} has DMs off, and your moderator permissions don't include messaging members with DMs off.`};
  if (restricted("pm") && !toStaff && counter("pm") >= LIMITS.newPmsPerDay) return {ok:false, why:`New members can message ${LIMITS.newPmsPerDay} members a day. Messages to moderators and admins don't count.`};
  return {ok:true, toStaff};
}

/* ---------- Staff directory ---------- */
function vStaff(){
  const staff = Object.values(USERS).filter(u => STAFF_ROLES.includes(u.role));
  const admins = staff.filter(u => isAdminUser(u.name)), mods = staff.filter(u => !isAdminUser(u.name));
  const msgBtn = name => signedIn() && name !== S.user ? `<button class="btn small" type="button" data-act="dm" data-user="${esc(name)}">Message</button>` : "";
  return crumbs(["Members","/members"],["Staff"]) + phead("Staff", "Moderators and admins. Any signed-in member can message staff, even New Members who've used their daily messages.",
    signedIn() && !isStaff() ? `<button class="btn primary" type="button" data-act="contactStaff" data-to="admins">Message the admin team</button><button class="btn" type="button" data-act="contactStaff" data-to="pick">Message a moderator</button>` : (!signedIn() ? `<button class="btn" type="button" data-act="signIn">Sign in to contact staff</button>` : "")) +
  `<div class="cols half"><section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Admins</h3></div><div class="tw"><table class="t"><tbody>
    ${admins.map(u=>`<tr><td><span class="row">${av(u.name)}${ulink(u.name)}${roleBadge(u.name)}</span></td><td class="muted">Site configuration, appeals, business verification</td><td class="n">${msgBtn(u.name)}</td></tr>`).join("")}</tbody></table></div></section>
  <section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Moderators</h3></div><div class="tw"><table class="t"><tbody>
    ${mods.map(u=>{ const bs = modBoardsOf(u.name); return `<tr><td><span class="row">${av(u.name)}${ulink(u.name)}${roleBadge(u.name)}</span></td>
      <td><div style="font-size:.9rem">${esc(modTemplate(u.name).name)}</div><div class="muted" style="font-size:.85rem">${modAllBoards(u.name) ? "All boards" : bs.length ? bs.map(b=>esc(b.name)).join(", ") : "No boards assigned"}</div></td><td class="n">${msgBtn(u.name)}</td></tr>`; }).join("")}</tbody></table></div></section></div>
  <p class="muted" style="font-size:.88rem">For a problem with a specific post, use Report on the post. It goes straight to the right moderator's queue.</p>`;
}
function vProfile(name){
  const u = USERS[name]; if (!u) return vMissing("No member by that name.");
  const self = name === S.user, staff = isStaff();
  const showAct = u.privacy.showActivity || self || staff;
  const recent = TOPICS.flatMap(t=>t.posts.filter(p=>p.author===name&&!p.hidden).map(p=>({t,p}))).sort((a,b)=>b.p.at-a.p.at).slice(0,6);
  const reviews = REVIEWS.filter(r=>r.user===name && r.status!=="removed");
  const fb = SELLER_FEEDBACK[name]||[];
  const blocked = S.user && BLOCKS[S.user]?.has(name);
  const dm = dmCheck(name);
  const canAct = ["user.warn","user.suspend","user.ban","user.restore"].some(k => mp(k)) && !isAdminUser(name) && !(isStaffUser(name) && !isAdminUser(S.user));
  const actions = !signedIn() ? "" : self
    ? `${link("/messages","My messages","btn primary")}${link("/settings","Edit profile & privacy","btn")}`
    : `<button class="btn primary" type="button" data-act="dm" data-user="${esc(name)}" ${dm.ok?"":`disabled title="${esc(dm.why)}"`}>Message</button>
       <button class="btn" type="button" data-act="block" data-user="${esc(name)}">${blocked?"Unblock":"Block"}</button>
       <button class="btn ghost" type="button" data-act="report" data-kind="user" data-user="${esc(name)}">Report</button>
       ${canAct ? `<button class="btn danger" type="button" data-act="userAction" data-user="${esc(name)}">Moderate</button>`:""}
       ${canAct && mp("user.warn") && (u.avatar || u.avatarColor) ? `<button class="btn ghost" type="button" data-act="clearAvatar" data-user="${esc(name)}">Remove avatar</button>`:""}
       ${canAct && mp("user.warn") && u.sig ? `<button class="btn ghost" type="button" data-act="clearSig" data-user="${esc(name)}">Clear signature</button>`:""}`;
  return crumbs(["Members","/members"],[name]) +
  `<div class="phead"><div class="ent">${av(name,"lg")}<div><h1 style="text-transform:none">${esc(name)}</h1><div class="row" style="margin-top:6px">${roleBadge(name)}${u.role !== "verified_seller" ? sellerBadge(name) : ""}<span class="pill">${esc(rankFor(u.posts))}</span>${u.status!=="active"?`<span class="pill red">${esc(u.status)}</span>`:""}${u.badges.map(b=>`<span class="pill green">${esc(b)}</span>`).join("")}</div>
    ${u.sig ? `<div class="sig" style="margin-top:6px;border:0;padding:0">${sigHtml(u.sig)}</div>` : ""}<p style="margin-top:6px">Joined ${dday(u.joined)} · ${fmt(u.posts)} posts · ${fmt(u.topics)} topics · ${fmt(u.likes)} likes received</p></div></div><div class="acts">${actions}</div></div>
  ${signedIn() && !self && !dm.ok ? `<div class="notice" style="margin-bottom:14px">${esc(dm.why)}</div>`:""}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:18px">${[["Forum",u.rep.forum,"Helpful posts, likes, age"],["Marketplace",u.rep.market,"Completed trades, feedback"],["Review",u.rep.review,"Helpful, verified reviews"],["Prediction",u.rep.prediction,"Accuracy, kept separate"]].map(([k,v,h])=>`<div class="panel"><div class="ph" style="margin-bottom:6px">${k} rep</div><div class="score" style="font-size:2rem">${v===null?"—":fmt(v)}</div><div class="muted" style="font-size:.8rem">${h}</div></div>`).join("")}</div>
  <div class="cols"><div class="stack">
    <section class="panel"><h3 class="ph">Recent activity</h3>${showAct ? (recent.map(({t,p})=>`<div style="padding:7px 0;border-top:1px solid var(--line)"><div class="meta">${link("/topic/"+t.id, esc(t.title))} · ${rel(p.at)}</div><div style="font-size:.93rem;overflow-wrap:anywhere">${esc(p.body.replace(/\[quote=[\s\S]*?\[\/quote\]/g,"").slice(0,140))}</div></div>`).join("") || '<p class="muted" style="margin:0">No posts yet.</p>') : '<p class="muted" style="margin:0">This member keeps their activity private.</p>'}</section>
    <section class="panel"><h3 class="ph">Reviews (${reviews.length})</h3>${reviews.map(r=>`<div class="spread" style="padding:6px 0;border-top:1px solid var(--line)">${link("/topic/"+r.thread, esc(op(r.op).name)+": "+esc(r.title))}<span><span class="stars">${stars(r.stars)}</span> ${statusPill(r.status)}</span></div>`).join("") || '<p class="muted" style="margin:0">None.</p>'}</section>
    <section class="panel"><h3 class="ph">Marketplace feedback</h3>${(() => { const done = ESCROWS.filter(e=>e.seller===name && e.status==="released").length, lost = ESCROWS.filter(e=>e.seller===name && ["refunded","split"].includes(e.status) && e.decision).length; return done || lost ? `<p style="margin:0 0 8px;font-size:.92rem">🔒 ${done} escrow deal${done===1?"":"s"} completed${lost?` · ${lost} dispute${lost>1?"s":""} lost`:""}</p>` : ""; })()}${fb.length?`<span class="stars">${stars(mean(fb))}</span> ${mean(fb).toFixed(1)} from ${fb.length} trades`:'<p class="muted" style="margin:0">No trades yet.</p>'}${LISTINGS.filter(l=>l.seller===name&&!l.removed&&(l.approval==="approved"||l.seller===S.user||mp("queue.listings"))).map(l=>`<div style="padding:5px 0">${link("/topic/"+l.thread, esc(l.title))} ${statusPill(l.status)}</div>`).join("")}</section>
  </div><aside class="stack">
    <section class="panel"><h3 class="ph">About</h3><p style="margin:0 0 8px">${esc(u.about)||'<span class="muted">Nothing here yet.</span>'}</p>${u.website?`<p class="muted" style="margin:0">Website: ${esc(u.website)}</p>`:""}</section>
    <section class="panel"><h3 class="ph">Favourites</h3><div class="row">${u.favTeams.map(s=>team(s)?link("/teams/"+s, esc(team(s).name),"pill"):"").join("")}${u.favSports.map(s=>{const sp=SPORTS.find(x=>x.slug===s);return sp?link("/sports/"+s, esc(sp.name),"pill"):"";}).join("")}</div>${!u.favTeams.length&&!u.favSports.length?'<p class="muted" style="margin:0">None set.</p>':""}</section>
    ${isStaffUser(name) ? `<section class="panel"><h3 class="ph">Staff role</h3><p style="margin:0 0 6px">${esc(roleLabel(u.role))}${isAdminUser(name)?"":` · ${esc(modTemplate(name).name)}`}</p><p class="muted" style="margin:0;font-size:.9rem">${isAdminUser(name)?"All boards":modAllBoards(name)?"All boards":modBoardsOf(name).map(b=>esc(b.name)).join(", ")||"No boards assigned"}</p></section>`:""}
    ${mp("user.view") ? `<section class="panel tool"><h3 class="ph">Staff view</h3><dl class="kv"><dt>Role</dt><dd>${esc(roleLabel(u.role))}</dd><dt>Status</dt><dd>${esc(u.status)}</dd><dt>Warnings</dt><dd>${u.warnings}</dd><dt>DMs</dt><dd>${esc(u.privacy.dms)}</dd><dt>2FA</dt><dd>${u.twoFA?"On":"Off"}</dd></dl></section>`:""}
  </aside></div>`;
}

/* ---------- Search (§22) ---------- */
function vSearch(qs){
  const q = (qs.q||"").trim(), ql = q.toLowerCase();
  const f = Object.assign({type:"all", board:"all", author:"", date:"any", rating:0}, S.ui.sf||{});
  const since = {any:0, "24h":Date.now()-DAY, "7d":Date.now()-7*DAY, "30d":Date.now()-30*DAY}[f.date];
  const by = x => !f.author || x === f.author;
  const R = {
    topics: readable().filter(t=>t.title.toLowerCase().includes(ql) && (f.board==="all"||t.board===f.board) && by(t.author) && t.at>=since).map(t=>({h:link("/topic/"+t.id, esc(t.title)), m:`Topic · ${esc(board(t.board).name)} · ${ulink(t.author)} · ${rel(t.at)}`})),
    posts: readable().flatMap(t=>visiblePosts(t).filter(p=>p.body.toLowerCase().includes(ql) && (f.board==="all"||t.board===f.board) && by(p.author) && p.at>=since).map(p=>({h:link("/topic/"+t.id, esc(t.title)), m:`Post by ${ulink(p.author)} · ${rel(p.at)} · “${esc(p.body.replace(/\[\/?quote[^\]]*\]/g,"").slice(0,90))}…”`}))),
    members: Object.values(USERS).filter(u=>u.name.includes(ql)).map(u=>({h:ulink(u.name), m:`Member · ${esc(rankFor(u.posts))} · ${fmt(u.posts)} posts`})),
    teams: TEAMS.filter(t=>t.name.toLowerCase().includes(ql)).map(t=>({h:link("/teams/"+t.slug, esc(t.name)), m:`Team · ${esc(league(t.league).name)}`})),
    leagues: LEAGUES.filter(l=>l.name.toLowerCase().includes(ql)).map(l=>({h:link("/leagues/"+l.slug, esc(l.name)), m:`League · ${esc(l.country)}`})),
    operators: OPERATORS.filter(o=>o.name.toLowerCase().includes(ql) && trust(o).avg>=f.rating).map(o=>({h:link(opPath(o), esc(o.name)), m:`${o.type==="casino"?"Casino":"Sportsbook"} · Safety Index ${safety(o).score.toFixed(1)} (${safety(o).label})`})),
    reviews: REVIEWS.filter(r=>r.status!=="removed" && (r.title+" "+r.body).toLowerCase().includes(ql) && r.stars>=f.rating && by(r.user) && r.at>=since).map(r=>({h:link("/topic/"+r.thread, esc(r.title)), m:`Review of ${esc(op(r.op).name)} · ${stars(r.stars)} · ${ulink(r.user)}`})),
    complaints: COMPLAINTS.filter(c=>(c.title+" "+c.statement+" "+op(c.op).name).toLowerCase().includes(ql) && by(c.user) && c.at>=since).map(c=>({h:link("/complaints/"+c.id, esc(c.title)), m:`Complaint ${c.id} · ${esc(op(c.op).name)} · ${statusPill(c.status)}${c.amount?" · "+money(c.amount):""}`})),
    listings: LISTINGS.filter(l=>!l.removed && l.approval==="approved" && (l.title+" "+l.desc).toLowerCase().includes(ql) && by(l.seller) && l.at>=since).map(l=>({h:link("/topic/"+l.thread, esc(l.title)), m:`Listing · ${esc(l.cat)} · ${esc(l.price)} · ${statusPill(l.status)}`}))
  };
  const types = Object.keys(R);
  const shown = f.type==="all" ? types.flatMap(k=>R[k]) : R[f.type];
  return crumbs(["Search"]) + phead(q?`Results for “${esc(q)}”`:"Search", "Posts, topics, members, teams, leagues, casinos, sportsbooks, reviews and the marketplace.") +
  `<form class="panel form" data-form="search" style="margin-bottom:14px"><div class="row" style="align-items:flex-end">
     <label style="flex:2 1 220px">Search for<input name="q" value="${esc(q)}" list="ac" autocomplete="off"></label>
     <label style="flex:1 1 140px">Board<select name="board"><option value="all">Any board</option>${BOARDS.filter(canReadBoard).map(b=>`<option value="${b.slug}" ${f.board===b.slug?"selected":""}>${esc(b.name)}</option>`).join("")}</select></label>
     <label style="flex:1 1 120px">Author<input name="author" value="${esc(f.author)}" list="aclist-users"></label>
     <label style="flex:1 1 110px">Date<select name="date">${[["any","Any time"],["24h","Last 24h"],["7d","Last week"],["30d","Last month"]].map(([v,t])=>`<option value="${v}" ${f.date===v?"selected":""}>${t}</option>`).join("")}</select></label>
     <label style="flex:1 1 100px">Min. rating<select name="rating">${[0,1,2,3,4].map(n=>`<option value="${n}" ${+f.rating===n?"selected":""}>${n?n+"★+":"Any"}</option>`).join("")}</select></label>
     <button class="btn primary" type="submit">Search</button></div></form>
  ${q?`<div class="tabs"><button type="button" data-act="sType" data-v="all" aria-pressed="${f.type==="all"}">All ${types.reduce((n,k)=>n+R[k].length,0)}</button>${types.map(k=>`<button type="button" data-act="sType" data-v="${k}" aria-pressed="${f.type===k}">${k[0].toUpperCase()+k.slice(1)} ${R[k].length}</button>`).join("")}</div>
  <section class="panel flush">${shown.length?`<ul class="tlist">${shown.slice(0,50).map(r=>`<li style="grid-template-columns:minmax(0,1fr)"><div style="min-width:0"><h4>${r.h}</h4><div class="meta">${r.m}</div></div></li>`).join("")}</ul>`:'<div class="empty">Nothing matched. Try fewer words or clear a filter.</div>'}</section>`:'<div class="empty">Type something to search.</div>'}`;
}

/* ---------- Notifications ---------- */
const NOTIF_TYPES = {mention:"Mentions", reply:"Replies", quote:"Quotes", like:"Likes", follow:"Follows", message:"Messages", review:"Reviews", complaint:"Complaints", market:"Marketplace", moderator:"Moderation"};
function vNotifications(){
  if (!signedIn()) return vMissing("Sign in to see notifications.");
  const f = S.ui.nf || "all";
  const mine = NOTIFS.filter(n=>n.to===S.user && (f==="all"||n.type===f)).sort((a,b)=>b.at-a.at);
  return crumbs(["Notifications"]) + phead("Notifications", "Email, browser and push delivery are set in Settings.", `<button class="btn" type="button" data-act="readAll">Mark all read</button>${link("/settings","Preferences","btn")}`) +
    `<div class="tabs"><button type="button" data-act="ui" data-k="nf" data-v="all" aria-pressed="${f==="all"}">All</button>${Object.entries(NOTIF_TYPES).map(([k,v])=>`<button type="button" data-act="ui" data-k="nf" data-v="${k}" aria-pressed="${f===k}">${v}</button>`).join("")}</div>
    <section class="panel flush">${mine.length?`<ul class="tlist">${mine.map(n=>`<li style="${n.read?"":"background:var(--turf-soft)"}"><div style="min-width:0"><h4><a href="#" data-act="openNotif" data-id="${n.id}">${esc(n.text)}</a></h4><div class="meta"><span class="pill">${esc(NOTIF_TYPES[n.type]||n.type)}</span><span>${rel(n.at)}</span>${n.read?"":'<span class="new">Unread</span>'}</div></div></li>`).join("")}</ul>`:'<div class="empty">You\'re all caught up.</div>'}</section>`;
}
/* =====================================================================
   CASINO REVIEWS & COMPLAINTS (Casino Guru-style)
   - Safety Index: 0–10 per operator from licence, complaint outcomes,
     unfair terms, size and user feedback. Weights are admin-configurable.
   - Ranked casino / sportsbook lists, tabbed operator pages.
   - Complaint Center: public cases mediated by complaint specialists.
   ===================================================================== */
let SAFETY_W = {licence:25, complaints:35, fairness:15, size:10, feedback:15};
const SAFETY_LABELS = {licence:"Licence", complaints:"Complaint handling", fairness:"Fair terms", size:"Operator size", feedback:"User feedback"};
const LICENCE = {mga:{score:100, label:"Malta Gaming Authority licence (strict)"}, ukgc:{score:100, label:"UK Gambling Commission licence (strict)"},
  curacao:{score:55, label:"Curaçao licence (basic player protection)"}, anjouan:{score:40, label:"Anjouan licence (basic player protection)"}, none:{score:0, label:"No licence disclosed"}};
const SIZE = {small:{score:40, label:"Small operator", div:1}, medium:{score:70, label:"Medium-sized operator", div:1.6}, large:{score:100, label:"Large operator", div:2.5}};
// Penalty per case outcome, scaled by the amount at stake and divided by operator size
const CASE_PENALTY = {"Unresolved":18, "No Response":26, "Partially Resolved":6, "Escalated":8};
const caseWeight = c => 1 + Math.log10(1 + (c.amount||0)/100);
const clamp = (n, a=0, b=100) => Math.max(a, Math.min(b, n));
const money = n => "$" + fmt(Math.round(n||0));

function safety(o){
  const cs = COMPLAINTS.filter(c => c.op === o.slug), size = SIZE[o.size] || SIZE.small, lic = LICENCE[o.regulator] || LICENCE.none;
  const rs = REVIEWS.filter(r => r.op === o.slug && r.status !== "removed");
  const pen = cs.reduce((n,c) => n + (CASE_PENALTY[c.status]||0) * caseWeight(c), 0) / size.div;
  const bonus = Math.min(10, cs.filter(c => c.status === "Resolved").length * 3);
  const parts = {
    licence: lic.score,
    complaints: clamp(100 - pen + bonus),
    fairness: clamp(100 - 35*o.unfairTerms.length - (o.warning ? (o.warning.status === "confirmed" ? 100 : 30) : 0)),
    size: size.score,
    feedback: rs.length ? (mean(rs.map(r=>r.stars)) - 1) / 4 * 100 : 50
  };
  const wsum = Object.values(SAFETY_W).reduce((a,b)=>a+b,0) || 1;
  const score = Math.round(Object.keys(SAFETY_W).reduce((n,k) => n + parts[k]*SAFETY_W[k], 0) / wsum) / 10;
  const good = [], bad = [];
  (lic.score >= 90 ? good : bad).push(lic.label);
  if (o.size === "large") good.push(`${size.label}, established ${o.est}`); else if (o.size === "small") bad.push(`${size.label}${o.est >= 2023 ? `, only running since ${o.est}` : ""}`);
  const cc = complaintCounts(o.slug);
  if (cc.resolved + cc.partial) good.push(`Resolved ${cc.resolved + cc.partial} of ${cc.total} complaints`);
  if (cc.unresolved) bad.push(`${cc.unresolved} unresolved complaint${cc.unresolved>1?"s":""}${cs.some(c=>c.status==="No Response")?", including ignoring our specialists":""}`);
  if (!cc.total) good.push("No complaints filed yet");
  o.unfairTerms.forEach(t => bad.push(`Unfair term: ${t}`));
  if (o.warning) bad.push(o.warning.status === "confirmed" ? "Confirmed scam finding" : "Open scam allegation under review");
  if (o.verified) good.push("Verified business that responds on Pitchside");
  return {score, parts, label: safetyLabel(score), tone: score >= 8 ? "good" : score >= 5 ? "mid" : "bad", good, bad};
}
function safetyLabel(n){ return n >= 9 ? "Very high" : n >= 8 ? "High" : n >= 7 ? "Above average" : n >= 5 ? "Average" : n >= 4 ? "Below average" : n >= 2 ? "Low" : "Very low"; }
function feedbackLabel(o){ const rs = REVIEWS.filter(r => r.op === o.slug && r.status !== "removed"); if (!rs.length) return {label:"No reviews yet", avg:0, n:0};
  const a = mean(rs.map(r=>r.stars)); return {label: a >= 4.5 ? "Excellent" : a >= 3.8 ? "Good" : a >= 2.8 ? "Mixed" : a >= 1.8 ? "Bad" : "Terrible", avg:a, n:rs.length}; }
function safetyBadge(o, size="md"){
  const s = safety(o);
  return `<span class="si si-${s.tone} si-${size}" title="Safety Index ${s.score.toFixed(1)} of 10: ${s.label}"><b>${s.score.toFixed(1)}</b><span>${size==="sm" ? "" : `Safety Index<br>`}<strong>${s.label}</strong></span></span>`;
}
const opInitials = o => o.name.split(" ").map(w=>w[0]).join("").slice(0,3);
const opCrest = (o, px=44) => `<span class="crest" style="background:${o.color};width:${px}px;height:${px}px;font-size:${px/3.2}px;border-radius:${px/4}px">${esc(opInitials(o))}</span>`;
const opPathTab = (o, tab) => opPath(o) + (tab ? "?tab=" + tab : "");

/* ---------- Hub: ranked casino / sportsbook lists ---------- */
// One merged list: casinos and sportsbooks together, filtered by how they take payments.
const PAY_TYPES = [["hybrid","Hybrid (fiat + crypto)"],["fiat","Fiat only"],["crypto","Crypto only"]];
const payType = o => o.crypto && o.fiat !== false ? "hybrid" : o.crypto ? "crypto" : "fiat";
const payLabel = o => ({hybrid:"Hybrid: fiat + crypto", fiat:"Fiat only", crypto:"Crypto only"})[payType(o)];
function vHub(qs={}){
  if (gated()) return ageGate();
  if (PAY_TYPES.some(p => p[0] === qs.pay)) S.ui.hub = Object.assign(S.ui.hub||{}, {pay:qs.pay});
  const f = Object.assign({rec:false, pay:"hybrid", country:"all", sort:"safety"}, S.ui.hub || {});
  const listed = OPERATORS.filter(o => !o.blacklist), nBlack = OPERATORS.length - listed.length;
  let list = listed.filter(o => payType(o) === f.pay && (f.country === "all" || o.countries.includes(f.country)) && (!f.rec || safety(o).score >= 7));
  const key = {safety:o=>-safety(o).score, feedback:o=>-feedbackLabel(o).avg, complaints:o=>-complaintCounts(o.slug).total, newest:o=>-o.est};
  list.sort((a,b) => key[f.sort](a) - key[f.sort](b));
  const countries = [...new Set(OPERATORS.flatMap(o=>o.countries))].filter(c=>c!=="Unknown").sort();
  const all = COMPLAINTS, recovered = all.reduce((n,c)=>n+(c.refunded||0),0), closed = all.filter(c=>!OPEN_STATUSES.includes(c.status));
  const resolvedPct = closed.length ? Math.round(closed.filter(c=>["Resolved","Partially Resolved"].includes(c.status)).length / closed.length * 100) : 0;
  const nPay = k => listed.filter(o => payType(o) === k).length;
  return crumbs(["Gambling","/gambling"],["Casinos & sportsbooks"]) +
    phead("Casinos & sportsbooks", `Each one gets a Safety Index from its licence, how it handles complaints, its terms and what members say. Ranked safest first.`,
      `<button class="btn primary" type="button" data-act="fileComplaint">File a complaint</button>${kindButton({kind:"review"})}`) +
    `<div class="cols"><div class="stack">
      <form class="panel row" data-form="dir" style="gap:14px">
        <label class="row" style="gap:6px;font-size:.92rem;font-weight:600">Payments <select class="inp" style="width:auto;font-weight:600" data-change="hubPay" id="hubPay">${PAY_TYPES.map(([v,t])=>`<option value="${v}" ${f.pay===v?"selected":""}>${t} (${nPay(v)})</option>`).join("")}</select></label>
        <label class="row" style="gap:6px;font-size:.92rem"><input type="checkbox" data-act="hubSet" data-k="rec" id="hubRec" ${f.rec?"checked":""}> Recommended only (7.0+)</label>
        <label class="row" style="gap:6px;font-size:.92rem">Country <select class="inp" style="width:auto" data-change="hubCountry" id="hubCountry"><option value="all">Any</option>${countries.map(c=>`<option ${f.country===c?"selected":""}>${c}</option>`).join("")}</select></label>
        <label class="row" style="gap:6px;font-size:.92rem">Sort <select class="inp" style="width:auto" data-change="hubSort" id="hubSort">${[["safety","Safety Index"],["feedback","User feedback"],["complaints","Most complaints"],["newest","Newest"]].map(([v,t])=>`<option value="${v}" ${f.sort===v?"selected":""}>${t}</option>`).join("")}</select></label>
      </form>
      ${list.map((o,i) => opCard(o, i+1)).join("") || `<div class="panel empty">Nothing matches these filters.</div>`}
      ${nBlack ? `<div class="notice red"><strong>${nBlack} blacklisted operator${nBlack>1?"s are":" is"} not listed here.</strong><span>${link("/blacklist","See the blacklist")} and why we warn players to avoid them.</span></div>` : ""}
    </div><aside class="stack">
      <section class="panel"><h3 class="ph">Complaint Center</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div><div class="score" style="font-size:1.6rem">${all.length}</div><div class="muted" style="font-size:.85rem">complaints</div></div>
          <div><div class="score" style="font-size:1.6rem">${resolvedPct}%</div><div class="muted" style="font-size:.85rem">resolved</div></div>
          <div><div class="score" style="font-size:1.6rem">${money(recovered)}</div><div class="muted" style="font-size:.85rem">recovered for players</div></div>
          <div><div class="score" style="font-size:1.6rem">${all.filter(c=>OPEN_STATUSES.includes(c.status)).length}</div><div class="muted" style="font-size:.85rem">open now</div></div></div>
        <div class="stack" style="gap:8px">${link("/complaints","Browse complaints","btn")}<button class="btn primary" type="button" data-act="fileComplaint">File a complaint</button></div></section>
      <section class="panel"><h3 class="ph">How we rate</h3><p style="margin:0 0 8px;font-size:.93rem">The Safety Index weighs licence, complaint handling, fair terms, size and member reviews. Advertising and affiliate deals never change it.</p>${link("/page/safety-index","Read the method")}</section>
    </aside></div>`;
}
/* ---------- Member star ratings (1 to 5) ---------- */
const RATE_LABEL = {1:"Terrible", 2:"Poor", 3:"Okay", 4:"Good", 5:"Excellent"};
const myReview = o => signedIn() ? REVIEWS.find(r => r.op === o.slug && r.user === S.user && r.status !== "removed" && Date.now() - r.at < 180*DAY) : null;
function starPicker(pre){
  return `<fieldset class="starpick"><legend>Your rating</legend>
    <div class="sp">${[5,4,3,2,1].map(n=>`<input type="radio" name="stars" id="sp${n}" value="${n}" data-change="starPick"${pre===n?" checked":""}><label for="sp${n}" title="${n}: ${RATE_LABEL[n]}"><span aria-hidden="true">★</span><span class="sr">${n} star${n>1?"s":""}, ${RATE_LABEL[n]}</span></label>`).join("")}</div>
    <span class="hint" id="spLabel">${pre ? `${pre} of 5: ${RATE_LABEL[pre]}` : "Tap a star: 1 is terrible, 5 is excellent"}</span></fieldset>`;
}
function rateWidget(o){
  if (S.role === "business" && o.reps.includes(S.user)) return "";
  const mine = myReview(o);
  if (mine) return `<div class="rate"><span class="muted">You rated it</span> <span class="stars">${stars(mine.stars)}</span> ${link("/topic/"+mine.thread, "Your review")}</div>`;
  return `<div class="rate" role="group" aria-label="Rate ${esc(o.name)}"><span class="muted">Rate it</span><span class="rate-stars">${[5,4,3,2,1].map(n=>`<button type="button" data-act="writeReview" data-slug="${o.slug}" data-stars="${n}" title="${n}: ${RATE_LABEL[n]}" aria-label="Rate ${esc(o.name)} ${n} out of 5, ${RATE_LABEL[n]}">★</button>`).join("")}</span></div>`;
}
function opCard(o, rank){
  const s = safety(o), fb = feedbackLabel(o), cc = complaintCounts(o.slug);
  return `<article class="panel opcard">
    <div class="oc-top">
      <span class="oc-rank">${rank}</span>${opCrest(o)}
      <div style="min-width:0;flex:1">
        <h3 style="margin:0">${link(opPath(o), esc(o.name))}</h3>
        <div class="meta" style="margin-top:3px"><span class="pill">${o.type==="casino"?"Casino":"Sportsbook"}</span>${o.verified?'<span class="pill green">Verified</span>':""}${warnBadge(o)}${o.affiliate?'<span class="pill blue" title="Pitchside earns a commission from this operator">Affiliate</span>':""}<span>${esc(LICENCE[o.regulator]?.label.split(" (")[0]||o.license)}</span><span>${payLabel(o)}</span><span>Min. deposit ${esc(o.minDeposit)}</span></div>
      </div>
      ${safetyBadge(o)}
    </div>
    <div class="oc-body">
      <ul class="pc">${o.pros.slice(0,2).map(p=>`<li class="pro">${esc(p)}</li>`).join("")}${o.cons.slice(0,2).map(c=>`<li class="con">${esc(c)}</li>`).join("")}</ul>
      <div class="oc-side"><div><span class="muted">Member rating</span> ${fb.n ? `<span class="stars">${stars(fb.avg)}</span> <strong>${fb.avg.toFixed(1)}</strong> <span class="muted">${fb.label} · ${link(opPathTab(o,"reviews"), `${fb.n} review${fb.n===1?"":"s"}`)}</span>` : `<strong>No reviews yet</strong>`}</div>
        <div><span class="muted">Complaints</span> ${link(opPathTab(o,"complaints"), `<strong>${cc.total}</strong>`)}${cc.total?` <span class="muted">· ${cc.resolved+cc.partial} resolved${cc.unresolved?`, ${cc.unresolved} unresolved`:""}</span>`:""}</div></div>
    </div>
    <div class="spread oc-foot">${rateWidget(o)}<div class="row">${link(opPathTab(o,"complaints"),"Complaints","btn small")}${affLinkFor(o.slug) && !o.blacklist ? link(opPath(o),"Read review","btn small") + affButton(affLinkFor(o.slug), "casino-list", "Visit site", "btn small primary") : link(opPath(o),"Read review","btn small primary")}</div></div>
    ${affLinkFor(o.slug) && !o.blacklist ? `<div style="text-align:right;margin-top:-6px">${affNote()}</div>` : ""}
  </article>`;
}

/* ---------- Operator page (tabs) ---------- */
function vOperator(slug, qs={}){
  if (gated()) return ageGate();
  const o = op(slug); if (!o) return vMissing("Unknown operator.");
  const tab = qs.tab || "overview", s = safety(o), fb = feedbackLabel(o), cc = complaintCounts(slug), t = trust(o);
  const rsAll = REVIEWS.filter(r=>r.op===slug && (r.status!=="removed" || mp("review.moderate") || r.user===S.user));
  const cases = COMPLAINTS.filter(c=>c.op===slug).sort((a,b)=>lastCaseAt(b)-lastCaseAt(a));
  const rep = isRep(slug);
  const tabs = [["overview","Overview"],["reviews",`User reviews (${rsAll.length})`],["complaints",`Complaints (${cases.length})`],["info","Info"]];
  const cats = REVIEW_CATS.map(k=>[k, mean(rsAll.filter(r=>r.status!=="removed").map(r=>r.scores[k]))]);
  let body = "";
  if (tab === "overview") body = `<div class="cols"><div class="stack">
      <section class="panel"><div class="spread" style="align-items:flex-start"><div><h2 class="sec" style="margin-bottom:4px">Safety Index</h2><p class="muted" style="margin:0;font-size:.92rem">Our rating of how safely ${esc(o.name)} treats players.</p></div>${safetyBadge(o,"lg")}</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">
          <div><h3 class="ph" style="color:var(--good)">What raises it</h3><ul class="pc">${s.good.map(x=>`<li class="pro">${esc(x)}</li>`).join("")||'<li class="muted">Nothing notable</li>'}</ul></div>
          <div><h3 class="ph" style="color:var(--danger)">What lowers it</h3><ul class="pc">${s.bad.map(x=>`<li class="con">${esc(x)}</li>`).join("")||'<li class="muted">Nothing notable</li>'}</ul></div></div>
        <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;font-size:.92rem">Score breakdown</summary><div style="margin-top:10px">${Object.keys(SAFETY_W).map(k=>`<div class="bar2" style="grid-template-columns:160px minmax(0,1fr) 44px"><span>${SAFETY_LABELS[k]} <span class="muted">${SAFETY_W[k]}%</span></span><div class="track"><i style="width:${s.parts[k]}%"></i></div><span class="num" style="text-align:right">${Math.round(s.parts[k])}</span></div>`).join("")}
          <p class="muted" style="font-size:.83rem;margin:6px 0 0">${link("/page/safety-index","How the Safety Index works")}. Advertising and affiliate deals never change it.</p></div></details></section>
      <section class="panel"><div class="spread"><h3 class="ph" style="margin:0">Complaints</h3>${link(opPathTab(o,"complaints"),"All complaints")}</div>${complaintBar(cc)}
        ${cases.slice(0,3).map(caseRow).join("") || '<p class="muted" style="margin:0">No complaints filed. That usually means a good record, or a new operator.</p>'}</section>
      <section class="panel"><div class="spread"><h3 class="ph" style="margin:0">User feedback: ${fb.label}</h3>${link(opPathTab(o,"reviews"), `${fb.n} review${fb.n===1?"":"s"}`)}</div>
        ${fb.n ? `<div class="row" style="margin:6px 0 10px"><span class="stars" style="font-size:1.2rem">${stars(fb.avg)}</span><span class="muted">${fb.avg.toFixed(1)} from ${fb.n} members · community trust score ${t.score.toFixed(1)}/10</span></div>
          ${cats.map(([k,v])=>`<div class="bar2"><span>${k}</span><div class="track"><i style="width:${v/5*100}%"></i></div><span class="num" style="text-align:right">${v?v.toFixed(1):"—"}</span></div>`).join("")}` : '<p class="muted" style="margin:0">No member reviews yet.</p>'}
        ${t.flags.length && mp("review.moderate") ? `<div class="notice red" style="margin-top:10px"><strong>Integrity flags (staff only).</strong><span>${t.flags.map(esc).join(" · ")}</span></div>`:""}</section>
    </div><aside class="stack">
      <section class="panel"><h3 class="ph">Pros and cons</h3><ul class="pc">${o.pros.map(p=>`<li class="pro">${esc(p)}</li>`).join("")}${o.cons.map(c=>`<li class="con">${esc(c)}</li>`).join("")}</ul></section>
      <section class="panel"><h3 class="ph">At a glance</h3>${opFacts(o, true)}${link(opPathTab(o,"info"),"All details")}</section>
      <section class="panel"><h3 class="ph">Official representatives</h3>${o.reps.length?o.reps.map(u=>`<div>${ulink(u)} <span class="pill blue">Official rep</span></div>`).join(""):`<p class="muted" style="margin:0">None. ${o.claimed?"":"The operator hasn't claimed this profile."}</p>`}</section>
    </aside></div>`;
  if (tab === "reviews") body = `<section class="panel flush"><div class="spread" style="padding:14px 16px 0"><h3 class="ph" style="margin:0">Member reviews of ${esc(o.name)}</h3>${link("/forum/"+reviewBoard(o.type),"Open the forum board")}</div>
      ${topicList(rsAll.map(r=>topic(r.thread)).filter(x=>x && !hiddenTopic(x)).sort((a,b)=>lastAt(b)-lastAt(a)), "No reviews yet. Be the first to post one.")}</section>`;
  if (tab === "complaints") body = `<div class="cols"><div class="stack"><section class="panel flush"><div style="padding:14px 16px 4px">${complaintBar(cc)}</div>${cases.length?`<div>${cases.map(caseRow).join("")}</div>`:'<div class="empty">No complaints filed against this operator.</div>'}</section></div>
      <aside class="stack"><section class="panel"><h3 class="ph">Problem with ${esc(o.name)}?</h3><p style="margin:0 0 10px;font-size:.93rem">Contact their support first. If that doesn't work, our specialists will take it up with them for free.</p><button class="btn primary" type="button" data-act="fileComplaint" data-slug="${slug}">File a complaint</button></section></aside></div>`;
  if (tab === "info") body = `<section class="panel">${opFacts(o, false)}<p class="muted" style="font-size:.83rem;margin:10px 0 0">${o.claimed?"Supplied by the operator and checked by moderators.":"Compiled by moderators. The operator hasn't claimed this profile."}</p></section>`;
  return crumbs(["Gambling","/gambling"],["Casinos & sportsbooks", "/casinos?pay=" + payType(o)],[o.name]) +
  `<div class="phead"><div class="ent">${opCrest(o,64)}<div><h1>${esc(o.name)}</h1>
    <div class="row" style="margin-top:6px"><span class="pill">${o.type}</span>${o.verified?'<span class="pill green">Verified business</span>':o.claimed?'<span class="pill">Claimed</span>':'<span class="pill">Unclaimed</span>'}${o.pendingClaim?'<span class="pill amber">Claim pending</span>':""}${o.blacklist?'<span class="pill red">Blacklisted</span>':""}${warnBadge(o)}${commercialBadge(o)}<span class="muted" style="font-size:.9rem">${esc(o.website)}</span></div></div></div>
    <div class="acts">${safetyBadge(o)}</div></div>
  <div class="row" style="margin:-4px 0 14px">${kindButton({kind:"review", opType:o.type})}${signedIn() && !rep ? `<button class="btn" type="button" data-act="fileComplaint" data-slug="${slug}">File a complaint</button>`:""}
      ${S.role==="business" && !o.claimed && !o.pendingClaim ?`<button class="btn" type="button" data-act="claim" data-slug="${slug}">Claim this profile</button>`:""}
      ${rep || can("manageCategories") ? `<button class="btn" type="button" data-act="editOperator" data-slug="${slug}">Edit business info</button>`:""}
      ${mp("operator.warning") ? `<button class="btn" type="button" data-act="setWarning" data-slug="${slug}">Warning label</button><button class="btn${o.blacklist?"":" danger"}" type="button" data-act="${o.blacklist?"unblacklist":"blacklistOp"}" data-slug="${slug}">${o.blacklist?"Remove from blacklist":"Blacklist"}</button>`:""}</div>
  ${o.blacklist ? `<div class="notice red" style="margin-bottom:14px"><strong>Blacklisted. We advise you not to play here.</strong><span>${esc(o.blacklist.note||"")} ${o.blacklist.reasons.map(esc).join(" · ")}. Added ${rel(o.blacklist.at)}. ${link("/blacklist","See the blacklist")}</span></div>` : ""}
  ${o.warning ? (o.warning.status==="confirmed" ? `<div class="notice red" style="margin-bottom:14px"><strong>Confirmed finding.</strong><span>Moderators reviewed the evidence and confirmed this operator acted in bad faith. ${o.warning.topic?link("/topic/"+o.warning.topic,"Read the case"):""}</span></div>`
     : `<div class="notice amber" style="margin-bottom:14px"><strong>Allegation, not a finding.</strong><span>A member has made a scam accusation that is still under review. The operator can respond. ${o.warning.topic?link("/topic/"+o.warning.topic,"Read the accusation"):""}</span></div>`) : ""}
  ${(() => { const l = affLinkFor(o.slug); return l && !o.blacklist ? `<section class="offer"><div style="min-width:0">${l.offer ? `<strong>${esc(l.offer)}</strong>` : `<strong>Visit ${esc(o.name)}</strong>`}<div>${affNote()}</div></div>${affButton(l, "operator-page", `Visit ${esc(o.name)}`)}</section>` : ""; })()}
  ${o.affiliate ? `<div class="notice" style="margin-bottom:14px"><strong>Disclosure.</strong><span>Pitchside may earn a commission if you sign up with ${esc(o.name)}. It doesn't affect the Safety Index or which reviews and complaints are shown.</span></div>`:""}
  <nav class="subnav" aria-label="${esc(o.name)} sections">${tabs.map(([k,l])=>`<a href="#" data-go="${opPathTab(o, k==="overview"?"":k)}"${tab===k?' aria-current="page"':""}>${l}</a>`).join("")}</nav>
  ${body}`;
}
function opFacts(o, short){
  const rows = [["Licence", o.license],["Owner", o.owner],["Established", o.est],["Withdrawal limit", o.withdrawalLimit],["Min. deposit", o.minDeposit],["Payments", payLabel(o)],
    ["Payment methods", o.withdrawals.join(", ")],["KYC", o.kyc],["Countries", o.countries.join(", ")],["Games", o.games],["Languages", o.languages],["Products", [o.sportsbook&&"Sportsbook",o.casino&&"Casino",o.poker&&"Poker"].filter(Boolean).join(", ")],["Website", o.website]];
  return `<dl class="kv" style="margin-bottom:10px">${(short ? rows.slice(0,6) : rows).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}
function complaintBar(cc){
  if (!cc.total) return "";
  const seg = [["Resolved",cc.resolved+cc.partial,"var(--good)"],["Open",cc.open,"var(--sky)"],["Rejected",cc.rejected,"var(--line)"],["Unresolved",cc.unresolved,"var(--danger)"]].filter(x=>x[1]);
  return `<div style="display:flex;height:10px;border-radius:6px;overflow:hidden;margin:10px 0 6px">${seg.map(([,n,c])=>`<i style="flex:${n};background:${c}"></i>`).join("")}</div>
    <div class="meta" style="margin-bottom:8px">${seg.map(([l,n,c])=>`<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c};margin-right:4px;vertical-align:middle"></i>${l} ${n}</span>`).join("")}</div>`;
}
const lastCaseAt = c => c.messages[c.messages.length-1].at;
function caseRow(c){
  const o = op(c.op);
  return `<div class="case"><div style="min-width:0"><h4 style="margin:0 0 3px;font-size:1rem">${link("/complaints/"+c.id, esc(c.title))}</h4>
    <div class="meta">${statusPill(c.status)}<span>${esc(o.name)}</span><span>${c.amount?money(c.amount):"No amount"}</span><span>${esc(c.cat)}</span><span>by ${ulink(c.user)}</span></div></div>
    <div class="stats" style="text-align:right;font-size:.85rem;color:var(--muted);white-space:nowrap"><div>${c.messages.filter(m=>m.role!=="system").length} in case · ${Math.max(0,(topic(c.thread)?.posts.length||1)-1)} comments</div><div>updated ${rel(lastCaseAt(c))}</div></div></div>`;
}

/* ---------- Complaint Center ---------- */
function vComplaints(qs){
  if (gated()) return ageGate();
  const g = S.ui.cgrp || "all", opF = qs.op || S.ui.cop || "all", q = (S.ui.cq||"").toLowerCase();
  const groups = {all:()=>true, open:c=>OPEN_STATUSES.includes(c.status), resolved:c=>["Resolved","Partially Resolved"].includes(c.status), unresolved:c=>["Unresolved","No Response"].includes(c.status), rejected:c=>["Rejected","Closed"].includes(c.status)};
  const list = COMPLAINTS.filter(c => groups[g](c) && (opF==="all"||c.op===opF) && (!q || (c.title+" "+c.statement+" "+op(c.op).name).toLowerCase().includes(q))).sort((a,b)=>lastCaseAt(b)-lastCaseAt(a));
  const all = COMPLAINTS, closed = all.filter(c=>!OPEN_STATUSES.includes(c.status));
  const ok = closed.filter(c=>["Resolved","Partially Resolved"].includes(c.status)).length;
  return crumbs(["Gambling","/gambling"],["Complaints"]) +
    phead("Complaint Center", "Had a problem with a casino or sportsbook? Our complaint specialists take it up with the operator for free. Every case is public, and the outcome counts toward the operator's Safety Index.",
      `<button class="btn primary" type="button" data-act="fileComplaint"${opF!=="all"?` data-slug="${opF}"`:""}>File a complaint</button>`) +
    `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:16px">
      ${[["Complaints filed",fmt(all.length)],["Resolved",`${closed.length?Math.round(ok/closed.length*100):0}%`],["Recovered for players",money(all.reduce((n,c)=>n+(c.refunded||0),0))],["Open now",fmt(all.filter(c=>OPEN_STATUSES.includes(c.status)).length)]].map(([k,v])=>`<div class="panel"><div class="ph" style="margin-bottom:6px">${k}</div><div class="score" style="font-size:1.8rem">${v}</div></div>`).join("")}</div>
    <section class="panel" style="margin-bottom:16px"><h3 class="ph">How it works</h3><ol class="steps">
      <li><strong>Contact support first</strong><span>Most problems are fixed there. Keep the chat or emails.</span></li>
      <li><strong>File a complaint</strong><span>Tell us what happened and upload evidence. You choose what's public.</span></li>
      <li><strong>A specialist takes it up</strong><span>They check the facts and contact the operator, who has 7 days to reply.</span></li>
      <li><strong>Outcome</strong><span>Resolved, rejected or unresolved. Ignored cases close as no response and lower the Safety Index.</span></li></ol></section>
    <div class="row" style="margin-bottom:12px">
      <div class="tabs" style="margin:0">${[["all","All"],["open","Open"],["resolved","Resolved"],["unresolved","Unresolved"],["rejected","Rejected"]].map(([k,l])=>`<button type="button" data-act="ui" data-k="cgrp" data-v="${k}" aria-pressed="${g===k}">${l} ${COMPLAINTS.filter(groups[k]).length}</button>`).join("")}</div>
      <select class="inp" style="width:auto" data-change="cOp" id="cOp" aria-label="Operator"><option value="all">All operators</option>${OPERATORS.map(o=>`<option value="${o.slug}" ${opF===o.slug?"selected":""}>${esc(o.name)}</option>`).join("")}</select>
      <input class="inp" style="flex:1 1 180px;width:auto" type="search" placeholder="Search complaints" value="${esc(S.ui.cq||"")}" data-input="cq" id="cq" aria-label="Search complaints"></div>
    <section class="panel flush">${list.length ? list.map(caseRow).join("") : '<div class="empty">No complaints match.</div>'}</section>`;
}

/* ---------- Complaint case page ---------- */
const STEPS = [["Submitted",["Open"]],["Specialist reviewing",["Under Investigation","Escalated"]],["Waiting for a reply",["Awaiting Business","Awaiting User"]],["Outcome",["Resolved","Partially Resolved","Unresolved","Rejected","No Response","Closed"]]];
function caseRole(c, name){
  if (name === "system") return "system";
  if (name === c.user) return "player";
  if (op(c.op).reps.includes(name)) return "casino";
  if (isStaffUser(name)) return "specialist";
  return "member";
}
function vComplaint(id, qs={}){
  if (gated()) return ageGate();
  const c = COMPLAINTS.find(x=>x.id===id); if (!c) return vMissing("Unknown complaint.");
  const tab = qs.tab === "discussion" ? "discussion" : "case", talk = topic(c.thread);
  const talkPosts = talk ? visiblePosts(talk) : [], talkN = Math.max(0, talkPosts.length - 1);
  const o = op(c.op), mine = c.user === S.user, rep = isRep(c.op), spec = mp("complaint.manage"), open = OPEN_STATUSES.includes(c.status);
  const stepIdx = STEPS.findIndex(st => st[1].includes(c.status));
  const seeEv = e => e.public || mine || spec;
  const fol = S.user && c.followers.has(S.user);
  const roleBadge_ = r => ({player:'<span class="pill">Player</span>', casino:`<span class="pill blue">Official ${esc(o.name)} rep</span>`, specialist:'<span class="pill green">Complaint specialist</span>', member:""}[r]||"");
  const msgs = c.messages.map(m => { const r = m.role === "system" ? "system" : caseRole(c, m.by);
    if (r === "system") return `<div class="sysmsg"><span>${esc(m.body)}</span><span class="muted">${dstr(m.at)}</span></div>`;
    return `<article class="post"><aside>${ulink(m.by)} ${roleBadge_(r)}</aside><div class="pb"><div class="meta"><span>${dstr(m.at)}</span></div><div class="body">${renderBody(m.body)}</div></div></article>`; }).join("");
  let composer = "";
  if (!open) composer = `<div class="notice">This case is closed: ${esc(STATUS_LABEL[c.status])}.${mine ? ` If something changes, ${link("/staff","message a specialist")}.` : ""}</div>`;
  else if (!signedIn()) composer = `<div class="notice"><span>Only the player, the operator and our specialists post in a case.</span><button class="btn small" type="button" data-act="signIn">Sign in</button></div>`;
  else if (mine || rep || spec) composer = `<form class="panel form" data-form="caseReply" data-id="${c.id}">
      <label for="caseBody">${spec && !mine && !rep ? "Reply as complaint specialist" : rep ? `Reply as ${esc(o.name)}'s official representative` : "Add to your complaint"}</label>
      <textarea id="caseBody" name="body" required placeholder="${rep ? "Explain what happened on your side and what you'll do." : spec ? "Ask a question or update both parties." : "Answer the specialist's questions or add details."}"></textarea>
      <div class="row" style="justify-content:space-between"><label class="row" style="gap:6px;font-size:.88rem">Attach<input type="file" name="files" multiple></label>
        <div class="row">${mine ? `<button class="btn ghost" type="button" data-act="caseWithdraw" data-id="${c.id}">Withdraw</button><button class="btn" type="button" data-act="caseSolved" data-id="${c.id}">My problem is solved</button>` : ""}<button class="btn primary" type="submit">Post</button></div></div></form>`;
  else composer = `<div class="notice"><span>Only the player, the operator and our specialists post in the case. Want to chip in? ${link("/complaints/"+c.id+"?tab=discussion","Join the community discussion")}.</span></div>`;
  const talkBox = !talk ? "" : !signedIn() ? `<div class="notice"><span>Sign in to join the discussion.</span><button class="btn small" type="button" data-act="signIn">Sign in</button></div>`
    : talk.locked ? `<div class="notice amber"><strong>Locked.</strong> Moderators closed this discussion.</div>`
    : !can("topic") ? `<div class="notice amber">Your account can't post right now.</div>`
    : `<form class="panel form" data-form="reply" data-topic="${talk.id}"><label for="replyBody">Add to the discussion</label>
        <textarea id="replyBody" name="body" required placeholder="Share a similar experience or advice. This doesn't go to the operator or the specialist."></textarea>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Post</button></div></form>`;
  const talkList = !talk ? "" : talkPosts.slice(1).map(p => `<article class="post" id="post-${p.id}"><aside>${ulink(p.author)} ${postBadge(talk, p)}</aside><div class="pb"><div class="meta"><span>${dstr(p.at)}</span></div><div class="body">${renderBody(p.body)}</div></div></article>`).join("")
    || `<div class="empty" style="padding:18px">No comments yet. Been through something similar? Start the conversation.</div>`;
  const caseTabs = `<nav class="subnav" aria-label="Complaint threads" style="margin-bottom:14px">
      <a href="#" data-go="/complaints/${c.id}"${tab==="case"?' aria-current="page"':""}>Case thread <span class="muted">· player, ${esc(o.name)}, specialist</span></a>
      <a href="#" data-go="/complaints/${c.id}?tab=discussion"${tab==="discussion"?' aria-current="page"':""}>Community discussion (${talkN})</a></nav>`;
  const mainCol = tab === "case"
    ? `<div class="notice" style="margin-bottom:0"><span><strong>Official case.</strong> Only ${ulink(c.user)}, ${esc(o.name)}'s representatives and our complaint specialists post here. Everyone can read it.</span></div><section class="panel flush">${msgs}</section>${composer}`
    : `<div class="notice" style="margin-bottom:0"><span><strong>Community discussion.</strong> Any member can chip in. It isn't part of the case and doesn't affect the outcome. ${talk ? link("/topic/"+talk.id, "Open in the forum") : ""}</span></div><section class="panel flush">${talkList}</section>${talkBox}`;
  const specTools = spec ? `<section class="panel tool"><h3 class="ph">Specialist tools</h3>
      ${!c.specialist ? `<button class="btn primary small" type="button" data-act="caseTake" data-id="${c.id}">Take this case</button>` : `<p style="margin:0 0 8px;font-size:.92rem">Assigned to ${ulink(c.specialist)}${c.specialist!==S.user?` <button class="btn small ghost" type="button" data-act="caseTake" data-id="${c.id}">Take over</button>`:""}</p>`}
      ${c.specialist ? `<div class="stack" style="gap:6px;margin-top:6px">
        <button class="btn small" type="button" data-act="caseStatus" data-id="${c.id}" data-v="Awaiting Business">Ask the operator (7-day deadline)</button>
        <button class="btn small" type="button" data-act="caseStatus" data-id="${c.id}" data-v="Awaiting User">Ask the player</button>
        <button class="btn small" type="button" data-act="caseStatus" data-id="${c.id}" data-v="Escalated">Escalate</button>
        <button class="btn small primary" type="button" data-act="caseOutcome" data-id="${c.id}">Record outcome…</button></div>` : ""}
      <div style="margin-top:12px"><strong style="font-size:.9rem">Private notes</strong>${c.modNotes.map(n=>`<div style="padding:6px 0;border-top:1px solid var(--line);font-size:.9rem">${ulink(n.by)} <span class="muted">${rel(n.at)}</span><div>${esc(n.text)}</div></div>`).join("")||'<p class="muted" style="margin:4px 0;font-size:.88rem">None yet.</p>'}
        <form data-form="modNote" data-id="${c.id}" class="form" style="margin-top:8px"><textarea name="body" aria-label="New private note" placeholder="Only staff see this" style="min-height:56px"></textarea><button class="btn small" type="submit">Add note</button></form></div></section>` : "";
  const deadline = c.status === "Awaiting Business" && c.deadline ? `<div class="notice amber" style="margin-bottom:12px"><strong>Waiting for ${esc(o.name)}.</strong><span>They have until ${dday(c.deadline)} to respond. If they don't, the case closes as no response and their Safety Index drops.</span></div>` : "";
  return crumbs(["Gambling","/gambling"],["Complaints","/complaints"],[c.id]) +
  `<div class="phead"><div style="min-width:0"><h1 style="text-transform:none;font-size:clamp(1.5rem,3.2vw,2rem)">${esc(c.title)}</h1>
    <p>${esc(c.id)} · against ${link(opPath(o), esc(o.name))} · filed by ${ulink(c.user)} · ${dday(c.at)}</p></div>
    <div class="acts">${statusPill(c.status)}${signedIn()?`<button class="btn small${fol?" on":""}" type="button" data-act="caseFollow" data-id="${c.id}">${fol?"Following":"Follow case"}</button>`:""}</div></div>
  <ol class="stepper">${STEPS.map(([l],i)=>`<li class="${i<stepIdx?"done":i===stepIdx?"now":""}">${i===STEPS.length-1&&stepIdx===i?esc(STATUS_LABEL[c.status]):l}</li>`).join("")}</ol>
  ${deadline}
  ${caseTabs}
  <div class="cols"><div class="stack">${mainCol}</div>
  <aside class="stack">
    <section class="panel"><h3 class="ph">Case details</h3><dl class="kv">
      <dt>Operator</dt><dd>${link(opPath(o), esc(o.name))}</dd><dt>Safety Index</dt><dd>${safetyBadge(o,"sm")}</dd>
      <dt>Amount</dt><dd>${c.amount?money(c.amount):"Not disclosed"}</dd>${c.refunded?`<dt>Recovered</dt><dd><strong>${money(c.refunded)}</strong></dd>`:""}
      <dt>Issue</dt><dd>${esc(c.cat)}</dd><dt>Status</dt><dd>${statusPill(c.status)}</dd><dt>Specialist</dt><dd>${c.specialist?ulink(c.specialist):'<span class="muted">Not assigned yet</span>'}</dd>
      <dt>Opened</dt><dd>${dday(c.at)}</dd><dt>Last update</dt><dd>${rel(lastCaseAt(c))}</dd><dt>Contacted support</dt><dd>${c.contactedSupport?"Yes":"No"}</dd></dl></section>
    <section class="panel"><h3 class="ph">Evidence ${mine && open ? `<button class="btn small" type="button" data-act="addEvidence" data-id="${c.id}">Add</button>`:""}</h3>
      ${c.evidence.map((e,i)=>seeEv(e)?`<div class="spread" style="padding:6px 0;border-top:1px solid var(--line)"><span class="mono" style="font-size:.85rem;overflow-wrap:anywhere">📎 ${esc(e.name)}</span><span class="row">${e.public?'<span class="pill green">Public</span>':'<span class="pill">Private</span>'}${mine?`<button class="btn small ghost" type="button" data-act="toggleEvidence" data-id="${c.id}" data-i="${i}">Make ${e.public?"private":"public"}</button>`:""}</span></div>`:"").join("") || '<p class="muted" style="margin:0;font-size:.9rem">No evidence uploaded.</p>'}
      ${c.evidence.some(e=>!seeEv(e))?`<p class="muted" style="font-size:.85rem;margin:8px 0 0">${c.evidence.filter(e=>!seeEv(e)).length} private file(s) visible only to the player and specialists.</p>`:""}</section>
    ${specTools}
    <section class="panel"><h3 class="ph">Effect on the Safety Index</h3><p class="muted" style="margin:0;font-size:.9rem">${{Resolved:"Resolved cases improve the operator's complaint-handling score.","Partially Resolved":"A partial resolution counts slightly against the operator.",Unresolved:"Unresolved cases lower the Safety Index, more so for larger amounts.","No Response":"Ignoring a complaint is the biggest penalty in the Safety Index.",Rejected:"Rejected cases don't affect the Safety Index.",Closed:"Withdrawn cases don't affect the Safety Index.",Escalated:"Escalated cases count against the operator until decided."}[c.status] || "Open cases don't affect the score until there's an outcome."}</p></section>
  </aside></div>`;
}

/* ---------- Safety Index method page ---------- */
/* ---------- Blacklisted casinos ---------- */
function vBlacklist(){
  if (gated()) return ageGate();
  const list = OPERATORS.filter(o => o.blacklist).sort((a,b) => b.blacklist.at - a.blacklist.at);
  const staff = mp("operator.warning");
  return crumbs(["Gambling","/gambling"],["Blacklisted casinos"]) +
    phead("Blacklisted casinos", "Casinos and sportsbooks we warn players to avoid. Each one was reviewed by our specialists, and the reasons are listed.",
      staff ? `<button class="btn danger" type="button" data-act="blacklistOp">Add to blacklist</button>` : (signedIn() ? `<button class="btn" type="button" data-act="fileComplaint">File a complaint</button>` : "")) +
    `<div class="cols"><div class="stack">
      ${list.map(o => { const cc = complaintCounts(o.slug);
        return `<article class="panel bl-card">
          <div class="oc-top">${opCrest(o)}
            <div style="min-width:0;flex:1"><h3 style="margin:0">${link(opPath(o), esc(o.name))}</h3>
              <div class="meta" style="margin-top:3px"><span class="pill red">Blacklisted</span><span class="pill">${o.type==="casino"?"Casino":"Sportsbook"}</span><span>${esc(LICENCE[o.regulator]?.label.split(" (")[0]||o.license)}</span><span>${payLabel(o)}</span><span>Added ${rel(o.blacklist.at)}</span></div></div>
            ${safetyBadge(o,"sm")}</div>
          ${o.blacklist.note ? `<p style="margin:0">${esc(o.blacklist.note)}</p>` : ""}
          <ul class="pc">${o.blacklist.reasons.map(r=>`<li class="con">${esc(r)}</li>`).join("")}</ul>
          <div class="spread oc-foot"><span class="muted" style="font-size:.9rem">${link(opPathTab(o,"complaints"), `${cc.total} complaint${cc.total===1?"":"s"}`)}${cc.unresolved?`, ${cc.unresolved} unresolved`:""}${o.warning&&o.warning.topic?` · ${link("/topic/"+o.warning.topic,"Scam report")}`:""}</span>
            <div class="row">${staff ? `<button class="btn small" type="button" data-act="unblacklist" data-slug="${o.slug}">Remove</button>` : ""}${link(opPath(o),"Full profile","btn small")}</div></div>
        </article>`; }).join("") || `<div class="panel empty">No operators are blacklisted right now.</div>`}
    </div><aside class="stack">
      <section class="panel"><h3 class="ph">Why an operator gets blacklisted</h3><ul class="pc" style="margin:0">${BLACKLIST_REASONS.map(r=>`<li class="con">${esc(r)}</li>`).join("")}</ul></section>
      <section class="panel"><h3 class="ph">Getting off the list</h3><p style="margin:0;font-size:.93rem">An operator can be removed once it pays affected players and fixes the problem. Owners can ${link("/staff","contact our staff")} with evidence. Advertising never affects the blacklist.</p></section>
      <section class="panel"><h3 class="ph">Lost money to one of these?</h3><p style="margin:0 0 10px;font-size:.93rem">File a complaint and our specialists will take it up for free.</p><button class="btn primary" type="button" data-act="fileComplaint">File a complaint</button></section>
    </aside></div>`;
}
function vSafetyPage(){
  return crumbs(["Gambling","/gambling"],["How we rate"]) + phead("How the Safety Index works", "A 0 to 10 rating of how safely an operator treats players. It's calculated the same way for everyone and published on every operator page.") +
  `<div class="cols"><div class="stack"><section class="panel"><h3 class="ph">What goes in</h3>
    ${Object.keys(SAFETY_W).map(k=>`<div style="padding:10px 0;border-top:1px solid var(--line)"><div class="spread"><strong>${SAFETY_LABELS[k]}</strong><span class="mono">${SAFETY_W[k]}%</span></div><p class="muted" style="margin:4px 0 0;font-size:.93rem">${{
      licence:"Strict regulators such as the MGA or UKGC score highest. Curaçao and Anjouan licences offer less protection. No licence scores zero.",
      complaints:"Resolved complaints help. Unresolved complaints hurt, more so for larger amounts, and ignoring our specialists hurts most. Larger operators are expected to get more complaints, so penalties are scaled by size.",
      fairness:"Each unfair term in the operator's terms and conditions lowers the score. An open scam allegation lowers it further, and a confirmed finding sets this part to zero.",
      size:"Bigger operators are more likely to pay large wins.",
      feedback:"The average star rating from member review topics."}[k]}</p></div>`).join("")}</section></div>
  <aside class="stack"><section class="panel"><h3 class="ph">Scale</h3>${[[9,"Very high"],[8,"High"],[7,"Above average"],[5,"Average"],[4,"Below average"],[2,"Low"],[0,"Very low"]].map(([n,l])=>`<div class="spread" style="padding:5px 0"><span>${l}</span><span class="mono">${n}+</span></div>`).join("")}</section>
    <section class="panel"><h3 class="ph">Independence</h3><p style="margin:0;font-size:.93rem">Advertising, sponsored placements and affiliate deals never change a Safety Index. Admins can adjust the weights, and every change is logged.</p></section></aside></div>`;
}
/* =====================================================================
   ESCROW VIEWS
   ===================================================================== */
const usd = n => (Math.round((n||0)*100)/100).toFixed(2);
const escrowOf = id => ESCROWS.find(e => e.id === id);
const netOf = id => ESCROW_SETTINGS.networks.find(n => n.id === id);
const walletKey = net => net === "tron" ? "tron" : "evm";
const shortAddr = a => a ? a.slice(0, 8) + "…" + a.slice(-6) : "";
const escrowPill = e => { const s = ESCROW_STATUS[e.status]; return `<span class="pill ${s.tone}">${s.label}</span>`; };
const escrowTotal = e => Math.round((e.amount + e.fee) * 100) / 100;
const isArbiter = () => mp("escrow.arbitrate");

// Which networks a seller can be paid on (needs a payout wallet of the right type)
function sellerNetworks(name){
  const w = (USERS[name] || {}).wallets || {};
  return ESCROW_SETTINGS.networks.filter(n => n.on && w[walletKey(n.id)]);
}
// Is escrow offered on this listing, and if not, why not?
function escrowCheck(l){
  if (!l.escrow) return {ok:false, why:"Escrow isn't offered on this listing."};
  if (!ESCROW_SETTINGS.boards.has(MARKET_BOARD[l.cat])) return {ok:false, why:"Escrow isn't available on this board."};
  if (!(l.usd >= ESCROW_SETTINGS.minUsd && l.usd <= ESCROW_SETTINGS.maxUsd)) return {ok:false, why:`Escrow deals must be between $${ESCROW_SETTINGS.minUsd} and $${fmt(ESCROW_SETTINGS.maxUsd)}.`};
  if (!sellerNetworks(l.seller).length) return {ok:false, why:`${l.seller} hasn't added a payout wallet yet.`};
  return {ok:true};
}
const openEscrowFor = l => ESCROWS.find(e => e.listing === l.id && ESCROW_OPEN.includes(e.status));

// Panel inside the listing header
function escrowListingBlock(l, t){
  const chk = escrowCheck(l), open = openEscrowFor(l), mine = l.seller === S.user;
  if (!l.escrow && !mine) return "";
  if (open && (open.buyer === S.user || mine || isArbiter()))
    return `<div class="escrowbox"><span class="esc-ico" aria-hidden="true">🔒</span><div style="min-width:0;flex:1"><strong>Escrow deal ${esc(open.id)} · ${escrowPill(open)}</strong><div class="muted" style="font-size:.88rem">${usd(open.amount)} ${open.token} on ${open.chain} · paid by ${ulink(open.buyer)}</div></div>${link("/escrow/"+open.id,"Open deal","btn small primary")}</div>`;
  if (open) return `<div class="escrowbox"><span class="esc-ico" aria-hidden="true">🔒</span><div style="flex:1"><strong>Escrow deal in progress</strong><div class="muted" style="font-size:.88rem">Someone else has paid into escrow for this.</div></div></div>`;
  if (!chk.ok) return mine ? `<div class="escrowbox off"><span class="esc-ico" aria-hidden="true">🔓</span><div style="flex:1"><strong>Escrow not active</strong><div class="muted" style="font-size:.88rem">${esc(chk.why)}${chk.why.includes("payout wallet") ? ` ${link("/settings","Add one in Settings")}.` : ""}</div></div></div>` : "";
  const nets = sellerNetworks(l.seller), fee = escrowFee(l.usd);
  const can = l.approval === "approved" && l.status === "Available" && !l.removed;
  return `<div class="escrowbox"><span class="esc-ico" aria-hidden="true">🔒</span>
    <div style="min-width:0;flex:1"><strong>Escrow available</strong> <span class="muted" style="font-size:.88rem">· optional · ${nets.map(n=>`${n.token} on ${n.chain}`).join(" · ")}</span>
      <div class="muted" style="font-size:.88rem">For protection, pay ${usd(l.usd + fee)} into an escrow contract and ${esc(l.seller)} is paid only when you confirm you got it (fee ${usd(fee)}: ${feeRule()}). Or message ${esc(l.seller)} and pay them directly, with no fee and no protection. ${link("/page/escrow","How it works")}</div></div>
    ${mine ? `<span class="muted" style="font-size:.88rem">People can pay you through escrow</span>` : can ? `<button class="btn primary" type="button" data-act="buyEscrow" data-id="${l.id}">Pay with escrow</button>` : `<span class="muted" style="font-size:.88rem">${l.status === "Sold" ? "Sold" : "Not available right now"}</span>`}</div>`;
}

/* ---------- Deal page ---------- */
const ESC_STEPS = [["Deposit",["awaiting"]],["Funded",["funded"]],["Delivered",["shipped","disputed"]],["Outcome",["released","refunded","split","cancelled","expired"]]];
function escrowRole(e){ return e.buyer === S.user ? "buyer" : e.seller === S.user ? "seller" : isArbiter() ? "arbiter" : null; }
function autoRelease(e){
  if (e.status === "shipped" && e.deadline && Date.now() > e.deadline) finishEscrow(e, "released", "system", "Auto-released: no confirmation or dispute in time");
  if (e.status === "awaiting" && Date.now() - e.createdAt > ESCROW_SETTINGS.depositHours * HR) { e.status = "expired"; e.events.push(EV(Date.now(), "system", "Expired: no deposit within " + ESCROW_SETTINGS.depositHours + " hours")); }
}
function vEscrow(id){
  const e = escrowOf(id); if (!e) return vMissing("No escrow deal with that ID.");
  const role = escrowRole(e);
  if (!role) return vMissing("Escrow deals are only visible to the two people in the deal and escrow arbiters.");
  autoRelease(e);
  const l = LISTINGS.find(x => x.id === e.listing), t = l && topic(l.thread), st = ESCROW_STATUS[e.status];
  const stepIdx = ESC_STEPS.findIndex(s => s[1].includes(e.status));
  const other = role === "buyer" ? e.seller : e.buyer;
  let act = "";
  if (role === "buyer" && e.status === "awaiting") act = `<section class="panel"><h3 class="ph">Send your deposit</h3>
      <p style="margin:0 0 10px">Send exactly <strong>${usd(escrowTotal(e))} ${e.token}</strong> on the <strong>${e.chain}</strong> network to the escrow contract, quoting deal ID <span class="mono">${e.dealId}</span>. Sending another token or network will lose the money.</p>
      <div class="addr"><span class="mono">${esc(e.contract)}</span><button class="btn small" type="button" data-act="copyText" data-text="${esc(e.contract)}">Copy</button></div>
      <p class="muted" style="font-size:.85rem;margin:8px 0 12px">The deal expires if nothing arrives within ${ESCROW_SETTINGS.depositHours} hours. In the real build your wallet app opens with these details filled in.</p>
      <div class="row"><button class="btn primary" type="button" data-act="escrowDeposit" data-id="${e.id}">Simulate deposit (prototype)</button><button class="btn ghost" type="button" data-act="escrowCancel" data-id="${e.id}">Cancel deal</button></div></section>`;
  else if (role === "seller" && e.status === "awaiting") act = `<section class="panel"><h3 class="ph">Waiting for ${esc(e.buyer)}'s deposit</h3><p style="margin:0">Don't send anything yet. You'll be notified when ${esc(e.buyer)}'s deposit is confirmed on ${e.chain}.</p></section>`;
  else if (role === "seller" && e.status === "funded") act = `<section class="panel"><h3 class="ph">The money is in escrow. Send the item.</h3>
      <p style="margin:0 0 10px">${usd(e.amount)} ${e.token} is locked in the contract. Ship or deliver the item, then mark it below. ${ESCROW_SETTINGS.autoReleaseDays} days after that, the money is released to you automatically unless ${esc(e.buyer)} opens a dispute.</p>
      <div class="row"><button class="btn primary" type="button" data-act="escrowShip" data-id="${e.id}">Mark as shipped / delivered</button><button class="btn ghost" type="button" data-act="escrowRefund" data-id="${e.id}">Can't do it? Refund ${esc(e.buyer)}</button></div></section>`;
  else if (role === "buyer" && e.status === "funded") act = `<section class="panel"><h3 class="ph">Your money is safe in escrow</h3>
      <p style="margin:0 0 10px">${esc(e.seller)} has been told to send the item. Release the money once you have it and it's as described.</p>
      <div class="row"><button class="btn primary" type="button" data-act="escrowRelease" data-id="${e.id}">I've received it, release payment</button><button class="btn" type="button" data-act="escrowDispute" data-id="${e.id}">Open a dispute</button></div></section>`;
  else if (e.status === "shipped") act = `<section class="panel"><h3 class="ph">${role === "buyer" ? "Check what you got" : `Waiting for ${esc(e.buyer)}`}</h3>
      <p style="margin:0 0 10px">${role === "buyer" ? `Release the payment when you're happy, or open a dispute if something's wrong. If you do nothing, the money goes to ${esc(e.seller)} on <strong>${dstr(e.deadline)}</strong>.` : `The money is released to you on <strong>${dstr(e.deadline)}</strong> unless ${esc(e.buyer)} confirms sooner or opens a dispute.`}</p>
      <div class="row">${role === "buyer" ? `<button class="btn primary" type="button" data-act="escrowRelease" data-id="${e.id}">Release payment</button><button class="btn" type="button" data-act="escrowDispute" data-id="${e.id}">Open a dispute</button>` : role === "seller" ? `<button class="btn ghost" type="button" data-act="escrowRefund" data-id="${e.id}">Refund ${esc(e.buyer)}</button>` : ""}
        <button class="btn ghost small" type="button" data-act="escrowSkip" data-id="${e.id}">Prototype: skip ${ESCROW_SETTINGS.autoReleaseDays} days</button></div></section>`;
  else if (e.status === "disputed") act = `<section class="panel tool"><h3 class="ph">In dispute</h3>
      <p style="margin:0 0 6px"><strong>${esc(e.dispute.reason)}</strong> · opened by ${ulink(e.dispute.by)} ${rel(e.dispute.at)}</p>
      <p style="margin:0 0 10px;white-space:pre-wrap">${esc(e.dispute.detail)}</p>
      <p class="muted" style="font-size:.88rem;margin:0 0 10px">The money stays locked until an escrow arbiter decides. Both sides should add their evidence below. The arbiter can only pay it out, refund it, or split it between you.</p>
      ${role === "arbiter" ? `<div class="row"><button class="btn primary" type="button" data-act="escrowDecide" data-id="${e.id}">Decide this dispute</button></div>` : role === "seller" ? `<div class="row"><button class="btn ghost" type="button" data-act="escrowRefund" data-id="${e.id}">Agree to a refund</button></div>` : ""}</section>`;
  else if (role === "arbiter" && ESCROW_OPEN.includes(e.status)) act = `<section class="panel"><h3 class="ph">${st.label}</h3><p style="margin:0">Nothing for an arbiter to do. You can only step in if someone in the deal opens a dispute.</p></section>`;
  else act = `<section class="panel"><h3 class="ph">${st.label}</h3><p style="margin:0">${{
      released:`${usd(e.amount)} ${e.token} was paid to ${esc(e.seller)}.`, refunded:`${usd(e.amount)} ${e.token} was refunded to ${esc(e.buyer)}.`,
      split: e.decision ? `${usd(e.decision.toBuyer)} ${e.token} refunded to ${esc(e.buyer)} and ${usd(e.decision.toSeller)} paid to ${esc(e.seller)}.` : "",
      cancelled:"The deal was cancelled before any money was sent.", expired:"No deposit arrived in time, so the deal closed."}[e.status]}
      ${e.decision ? `<br><span class="muted">Arbiter ${ulink(e.decision.by)}: ${esc(e.decision.reason)}</span>` : ""}</p>
      ${role === "buyer" && ["released","split"].includes(e.status) && l && !l.feedback.some(f=>f.from===S.user) ? `<div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="leaveFeedback" data-id="${l.id}">Leave feedback for ${esc(e.seller)}</button></div>` : ""}</section>`;
  const canNote = ["funded","shipped","disputed"].includes(e.status) && (role === "buyer" || role === "seller" || role === "arbiter");
  return crumbs(["Marketplace","/marketplace"],["Escrow","/escrow"],[e.id]) +
  `<div class="phead"><div style="min-width:0"><h1 style="font-size:clamp(1.5rem,3.2vw,2rem)">${l ? esc(l.title) : "Listing removed"}</h1>
    <p>Escrow ${esc(e.id)} · ${usd(e.amount)} ${e.token} on ${e.chain} · ${role === "arbiter" ? "you're viewing as an escrow arbiter" : (role === "buyer" ? "you're paying" : "you're getting paid")}</p></div>
    <div class="acts">${escrowPill(e)}${other && role !== "arbiter" ? `<button class="btn small" type="button" data-act="dm" data-user="${esc(other)}">Message ${esc(other)}</button>` : ""}</div></div>
  <ol class="stepper">${ESC_STEPS.map(([lab],i)=>`<li class="${i<stepIdx?"done":i===stepIdx?"now":""}">${i===3 && stepIdx===3 ? st.label : lab}</li>`).join("")}</ol>
  <div class="cols"><div class="stack">${act}
    <section class="panel flush"><div style="padding:14px 16px 4px"><h3 class="ph">Deal history</h3></div>
      ${e.events.map(ev=>`<div class="sysmsg" style="background:none"><span>${ev.by==="system"?"":`${ulink(ev.by)} · `}${esc(ev.text)}${ev.tx?` <span class="mono" title="${esc(ev.tx)}" style="font-size:.78rem">tx ${shortAddr(ev.tx)}</span>`:""}</span><span class="muted">${dstr(ev.at)}</span></div>`).join("")}
      ${canNote ? `<form class="form" data-form="escrowNote" data-id="${e.id}" style="padding:12px 16px;border-top:1px solid var(--line)"><label for="escNote">${e.status==="disputed"?"Add evidence or a statement":"Add a note to the deal"} <span class="hint">Seen by both of you and escrow arbiters</span></label><textarea id="escNote" name="body" style="min-height:64px" required></textarea><button class="btn small" type="submit" style="align-self:flex-start">Add</button></form>` : ""}</section>
  </div><aside class="stack">
    <section class="panel"><h3 class="ph">Deal details</h3><dl class="kv">
      <dt>Item price</dt><dd>${usd(e.amount)} ${e.token}</dd><dt>Escrow fee</dt><dd>${usd(e.fee)} ${e.token} (added to the payment)</dd>
      <dt>${esc(e.buyer)} pays</dt><dd><strong>${usd(escrowTotal(e))} ${e.token}</strong></dd><dt>${esc(e.seller)} receives</dt><dd>${usd(e.amount)} ${e.token}</dd>
      <dt>Network</dt><dd>${e.chain} (${e.token})</dd><dt>Deal ID</dt><dd class="mono">${e.dealId}</dd>
      <dt>Contract</dt><dd class="mono" style="font-size:.8rem">${shortAddr(e.contract)} <button class="btn small ghost" type="button" data-act="copyText" data-text="${esc(e.contract)}" style="padding:0 4px">Copy</button></dd>
      <dt>Paying</dt><dd>${ulink(e.buyer)}</dd><dt>Getting paid</dt><dd>${ulink(e.seller)}</dd>
      <dt>Opened</dt><dd>${dday(e.createdAt)}</dd>${e.deadline && e.status==="shipped" ? `<dt>Auto-release</dt><dd>${dstr(e.deadline)}</dd>` : ""}
      ${l ? `<dt>Listing</dt><dd>${link("/topic/"+l.thread,"View listing")}</dd>` : ""}</dl></section>
    <section class="panel"><h3 class="ph">Who holds the money</h3><p style="margin:0;font-size:.92rem">An audited escrow smart contract, not Pitchside. It can only pay out to the person who posted the listing or refund the person who paid. If there's a dispute, a Pitchside arbiter decides which, and every decision is logged.</p></section>
  </aside></div>`;
}

/* ---------- My deals ---------- */
function vEscrowList(){
  if (!signedIn()) return `<section class="panel" style="max-width:520px;margin:30px auto;text-align:center"><h2 class="sec">Escrow deals</h2><p>Sign in to see your escrow purchases and sales.</p><button class="btn primary" type="button" data-act="signIn">Sign in</button></section>`;
  const f = S.ui.escF || "mine";
  const list = ESCROWS.filter(e => f === "all" ? isArbiter() : f === "disputes" ? (isArbiter() && e.status === "disputed") : (e.buyer === S.user || e.seller === S.user)).sort((a,b)=>b.createdAt-a.createdAt);
  list.forEach(autoRelease);
  const row = e => { const l = LISTINGS.find(x=>x.id===e.listing);
    return `<div class="case"><div style="min-width:0"><h4 style="margin:0 0 3px;font-size:1rem">${link("/escrow/"+e.id, l?esc(l.title):"Listing removed")}</h4>
      <div class="meta">${escrowPill(e)}<span>${e.id}</span><span>${usd(e.amount)} ${e.token} on ${e.chain}</span><span>${e.buyer===S.user?`paying ${ulink(e.seller)}`:e.seller===S.user?`getting paid by ${ulink(e.buyer)}`:`${ulink(e.buyer)} → ${ulink(e.seller)}`}</span></div></div>
      <div class="stats" style="text-align:right;font-size:.85rem;color:var(--muted);white-space:nowrap">${dday(e.createdAt)}</div></div>`; };
  return crumbs(["Marketplace","/marketplace"],["Escrow"]) + phead("Escrow deals", "Stablecoin payments held by an escrow contract until the person paying confirms they got what they paid for.", link("/page/escrow","How escrow works","btn")) +
    `<div class="tabs"><button type="button" data-act="ui" data-k="escF" data-v="mine" aria-pressed="${f==="mine"}">My deals</button>${isArbiter()?`<button type="button" data-act="ui" data-k="escF" data-v="disputes" aria-pressed="${f==="disputes"}">Disputes ${ESCROWS.filter(e=>e.status==="disputed").length}</button><button type="button" data-act="ui" data-k="escF" data-v="all" aria-pressed="${f==="all"}">All deals</button>`:""}</div>
    <section class="panel flush">${list.length ? list.map(row).join("") : `<div class="empty">No escrow deals yet. Look for listings marked <span class="pill blue">Escrow</span> in the ${link("/marketplace","Marketplace")}.</div>`}</section>`;
}

/* ---------- How it works ---------- */
function vEscrowHow(){
  const S_ = ESCROW_SETTINGS;
  return crumbs(["Marketplace","/marketplace"],["How escrow works"]) + phead("How escrow works", "Buy from other members without trusting them with your money first. Stablecoins only, so the amount doesn't change while it's held.") +
  `<div class="cols"><div class="stack"><section class="panel"><ol class="steps" style="grid-template-columns:1fr">
      <li><strong>Pay with escrow</strong><span>On a listing marked Escrow, choose USDT on Tron or USDC on Base or Polygon. You pay the price plus an escrow fee of ${feeRule()}.</span></li>
      <li><strong>Deposit into the contract</strong><span>Send the exact amount to the escrow contract within ${S_.depositHours} hours. Nobody, including Pitchside, can move it anywhere except to the other person or back to you.</span></li>
      <li><strong>They deliver</strong><span>They're told the money is locked, then ship or deliver and mark it done.</span></li>
      <li><strong>You confirm</strong><span>Release the payment when you're happy. If you do nothing for ${S_.autoReleaseDays} days after delivery, it releases automatically.</span></li>
      <li><strong>Something wrong?</strong><span>Open a dispute before it releases. The money stays locked, both sides post evidence, and a Pitchside escrow arbiter refunds you, pays the other person, or splits it.</span></li></ol></section>
    <section class="panel"><h3 class="ph">Rules</h3><ul class="pc">
      <li class="pro">Deals between $${S_.minUsd} and $${fmt(S_.maxUsd)}</li><li class="pro">Only USDT and USDC. Sending any other token or network loses the money.</li>
      <li class="pro">Available on most boards. Not on Tickets, Crypto Trades or Jobs.</li><li class="con">New members can buy with escrow after their first ${LIMITS.newMemberPostsToGraduate} posts.</li>
      <li class="pro">Escrow is optional. Whoever posts a listing chooses whether to offer it, and whoever pays chooses whether to use it or pay directly.</li><li class="con">Paying directly has no protection. Check their marketplace feedback and look for the ✓ Verified badge.</li></ul></section></div>
  <aside class="stack"><section class="panel"><h3 class="ph">Fees</h3><dl class="kv"><dt>Escrow fee</dt><dd>${feeRule()}, added to the payment</dd><dt>On a $100 item</dt><dd>$${usd(escrowFee(100))}</dd><dt>On a $2,500 item</dt><dd>$${usd(escrowFee(2500))}</dd>${S_.networks.filter(n=>n.on).map(n=>`<dt>${n.chain} ${n.token}</dt><dd>~$${n.gasUsd.toFixed(2)} network fee</dd>`).join("")}</dl></section>
    <section class="panel"><h3 class="ph">Offering escrow on your listings</h3><p style="margin:0 0 8px;font-size:.93rem">Add a payout wallet in Settings, then tick "Accept escrow" when you post a listing. Escrow listings tend to get more takers because there's less risk.</p>${link("/settings","Add a payout wallet")}</section></aside></div>`;
}

/* ---------- Admin: escrow ---------- */
function aEscrow(){
  const S_ = ESCROW_SETTINGS, vol = ESCROWS.filter(e=>["released","split"].includes(e.status)).reduce((n,e)=>n+e.amount,0);
  const fees = ESCROWS.filter(e=>["released","split","refunded"].includes(e.status) && e.feeKept !== false).reduce((n,e)=>n+(e.status==="refunded"?0:e.fee),0);
  const locked = ESCROWS.filter(e=>["funded","shipped","disputed"].includes(e.status)).reduce((n,e)=>n+e.amount,0);
  const escBoards = BOARDS.filter(b=>b.kind==="listing");
  return `<h2 class="sec" style="margin-top:22px">Escrow</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px">${[["Completed volume","$"+fmt(vol)],["Locked in contracts","$"+fmt(locked)],["Fees earned","$"+usd(fees)],["Open disputes",ESCROWS.filter(e=>e.status==="disputed").length]].map(([k,v])=>`<div class="panel"><div class="ph" style="margin-bottom:6px">${k}</div><div class="score" style="font-size:1.6rem">${v}</div></div>`).join("")}</div>
  <div class="cols half"><form class="panel form" data-form="escrowSettings"><h3 class="ph">Escrow settings</h3>
    <div class="row"><label style="flex:1">Fee %<input class="inp" type="number" step="0.1" min="0" max="10" name="fee" value="${S_.feePct}"></label><label style="flex:1">Minimum fee ($)<input class="inp" type="number" step="1" min="0" name="feeMin" value="${S_.feeMin}"></label><label style="flex:1">Auto-release (days)<input class="inp" type="number" min="1" max="30" name="days" value="${S_.autoReleaseDays}"></label></div>
    <div class="row"><label style="flex:1">Min deal ($)<input class="inp" type="number" min="1" name="min" value="${S_.minUsd}"></label><label style="flex:1">Max deal ($)<input class="inp" type="number" min="1" name="max" value="${S_.maxUsd}"></label></div>
    <fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">Networks</legend>${S_.networks.map(n=>`<label class="chk"><input type="checkbox" name="net_${n.id}" ${n.on?"checked":""}> ${n.token} on ${n.chain}</label>`).join("")}</fieldset>
    <fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">Boards that allow escrow</legend><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px">${escBoards.map(b=>`<label class="chk" style="font-size:.88rem"><input type="checkbox" name="b_${b.slug}" ${S_.boards.has(b.slug)?"checked":""}> ${b.parent?"↳ ":""}${esc(b.name)}</label>`).join("")}</div></fieldset>
    <button class="btn primary" type="submit" style="align-self:flex-start">Save escrow settings</button></form>
  <section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Recent deals</h3></div><div class="tw"><table class="t"><thead><tr><th>Deal</th><th>Status</th><th class="n">Amount</th><th>Parties</th></tr></thead><tbody>
    ${ESCROWS.slice().sort((a,b)=>b.createdAt-a.createdAt).map(e=>`<tr><td>${link("/escrow/"+e.id, e.id)}<div class="muted" style="font-size:.8rem">${e.chain} ${e.token}</div></td><td>${escrowPill(e)}</td><td class="n">${usd(e.amount)}</td><td style="font-size:.88rem">${ulink(e.buyer)} → ${ulink(e.seller)}</td></tr>`).join("")}</tbody></table></div></section></div>`;
}
/* =====================================================================
   SELLER VERIFICATION VIEWS
   ===================================================================== */
function sellerBadge(name, small){
  if (!isVerifiedSeller(name)) return "";
  return `<span class="pill vs${small?" sm":""}" title="Pitchside checked this member's identity, phone and account history">✓ Verified</span>`;
}
function sellerEligibility(u){
  const age = Math.floor((Date.now() - u.joined) / DAY);
  return [
    {ok: age >= SELLER_RULES.minAgeDays, text:`Account at least ${SELLER_RULES.minAgeDays} days old`, have:`${age} day${age===1?"":"s"}`},
    {ok: u.posts >= SELLER_RULES.minPosts, text:`At least ${SELLER_RULES.minPosts} posts`, have:`${fmt(u.posts)} posts`},
    {ok: u.warnings <= SELLER_RULES.maxWarnings, text:"No active warnings", have:`${u.warnings} warning${u.warnings===1?"":"s"}`},
    {ok: u.status === "active", text:"Account in good standing", have:u.status}
  ];
}
const verifReady = u => VCHECKS.filter(c=>c.req).every(c=>u.sellerVerif.checks[c.id]) && sellerEligibility(u).every(e=>e.ok);
const vStatusPill = v => ({none:"", pending:'<span class="pill amber">Under review</span>', verified:'<span class="pill vs">✓ Verified</span>', rejected:'<span class="pill red">Not approved</span>', revoked:'<span class="pill red">Verification revoked</span>'}[v.status] || "");

function vVerifySeller(){
  if (!signedIn()) return `<section class="panel" style="max-width:520px;margin:30px auto;text-align:center"><h2 class="sec">Get verified</h2><p>Sign in to apply.</p><button class="btn primary" type="button" data-act="signIn">Sign in</button></section>`;
  const u = me(), v = u.sellerVerif, locked = v.status === "pending" || v.status === "verified";
  const elig = sellerEligibility(u), ready = verifReady(u);
  const stepBtn = c => {
    if (v.checks[c.id]) return '<span class="pill green">Done</span>';
    if (locked || c.id === "email") return '<span class="pill">Not done</span>';
    return `<button class="btn small" type="button" data-act="verifStep" data-step="${c.id}">${c.id==="phone"?"Verify phone":c.id==="id"?"Verify ID":"Upload"}</button>`;
  };
  const head = {
    none:`<div class="notice" style="margin-bottom:16px"><span>Verified members get a <strong>✓ Verified</strong> badge on every listing and their profile, and show up when people filter the marketplace for verified members only.</span></div>`,
    pending:`<div class="notice amber" style="margin-bottom:16px"><strong>Under review.</strong><span>Submitted ${rel(v.appliedAt)}. A moderator usually decides within 2 days. You'll get a notification.</span></div>`,
    verified:`<div class="notice" style="margin-bottom:16px;background:var(--good-soft)"><strong>You're verified.</strong><span>Verified ${dday(v.decidedAt)}. The badge shows on your listings and profile. Keep your record clean: lost disputes or scam reports can lead to verification being revoked.</span></div>`,
    rejected:`<div class="notice red" style="margin-bottom:16px"><strong>Not approved.</strong><span>${esc(v.reason || "")} Fix this and apply again.</span></div>`,
    revoked:`<div class="notice red" style="margin-bottom:16px"><strong>Verification revoked.</strong><span>${esc(v.reason || "")} Message the moderators if you think this is wrong.</span></div>`
  }[v.status];
  return crumbs(["Marketplace","/marketplace"],["Get verified"]) + phead("Get verified", "Show the people you deal with that you're real and accountable. It's free and takes about five minutes.", vStatusPill(v)) + head +
  `<div class="cols"><div class="stack">
    <section class="panel"><h3 class="ph">1. Confirm who you are</h3>${VCHECKS.map(c=>`<div class="vrow"><div style="min-width:0"><strong>${esc(c.label)}</strong>${c.req?"":' <span class="muted" style="font-size:.85rem">(optional)</span>'}<div class="muted" style="font-size:.86rem">${esc(c.hint)}${c.id==="phone" && v.phone ? ` · ${esc(v.phone)}` : ""}</div></div>${stepBtn(c)}</div>`).join("")}</section>
    <section class="panel"><h3 class="ph">2. Account requirements</h3>${elig.map(e=>`<div class="vrow"><span>${e.ok?"✓":"✕"} ${esc(e.text)}</span><span class="pill ${e.ok?"green":"red"}">${esc(e.have)}</span></div>`).join("")}</section>
    ${["none","rejected","revoked"].includes(v.status) ? `<section class="panel"><h3 class="ph">3. Submit for review</h3>
      <p style="margin:0 0 10px">${ready ? "Everything's ready. A moderator will check your details and marketplace history." : "Finish the required checks and account requirements above first."}</p>
      <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="vAgree"> I agree to the marketplace rules: describe things honestly, deliver within 5 days, and accept escrow dispute decisions</label>
      <button class="btn primary" type="button" data-act="verifSubmit" ${ready?"":"disabled"}>Submit application</button></section>` : ""}
    ${v.history.length ? `<section class="panel flush"><div style="padding:14px 16px 4px"><h3 class="ph">History</h3></div>${v.history.slice().reverse().map(h=>`<div class="sysmsg" style="background:none"><span>${h.by==="system"?"":ulink(h.by)+" · "}${esc(h.text)}</span><span class="muted">${dstr(h.at)}</span></div>`).join("")}</section>` : ""}
  </div><aside class="stack">
    <section class="panel"><h3 class="ph">What others see</h3><p style="margin:0 0 8px">${sellerBadge("kitbag_kojo") || '<span class="pill vs">✓ Verified</span>'}</p><p class="muted" style="margin:0;font-size:.9rem">On your listings, your profile and next to your name in marketplace topics. People can filter the marketplace to verified members only.</p></section>
    <section class="panel"><h3 class="ph">Your privacy</h3><p style="margin:0;font-size:.9rem">Your ID and selfie go straight to our verification provider. Pitchside only receives a pass or fail. Your phone number is never shown publicly.</p></section>
    <section class="panel"><h3 class="ph">Is it required?</h3><p style="margin:0;font-size:.9rem">No. Anyone can post listings. Verification and escrow are both optional, and everyone decides how much they care about each.</p></section>
  </aside></div>`;
}

// Review card used in the moderation queue and in Admin → Marketplace
function sellerReviewBody(name){
  const u = USERS[name], v = u.sellerVerif, elig = sellerEligibility(u);
  const fb = SELLER_FEEDBACK[name] || [], deals = ESCROWS.filter(e=>e.seller===name), won = deals.filter(e=>e.status==="released").length, lost = deals.filter(e=>["refunded","split"].includes(e.status) && e.decision).length;
  const disputes = REPORTS.filter(r=>r.kind==="listing" && LISTINGS.some(l=>l.id===r.target.listing && l.seller===name)).length;
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:10px 0">
    <div><strong style="font-size:.9rem">Checks</strong>${VCHECKS.map(c=>`<div style="font-size:.9rem">${v.checks[c.id]?"✓":"✕"} ${esc(c.label)}${c.id==="id"&&v.checks.id?' <span class="muted">(provider: pass)</span>':""}</div>`).join("")}</div>
    <div><strong style="font-size:.9rem">Account</strong>${elig.map(e=>`<div style="font-size:.9rem">${e.ok?"✓":"✕"} ${esc(e.text)} <span class="muted">(${esc(e.have)})</span></div>`).join("")}</div>
    <div><strong style="font-size:.9rem">Marketplace record</strong><div style="font-size:.9rem">${fb.length?`${stars(mean(fb))} ${mean(fb).toFixed(1)} from ${fb.length} trades`:"No feedback yet"}</div>
      <div style="font-size:.9rem">${won} escrow deal${won===1?"":"s"} completed${lost?`, ${lost} dispute${lost>1?"s":""} lost`:""}</div><div style="font-size:.9rem">${disputes} listing report${disputes===1?"":"s"}</div>
      <div style="font-size:.9rem">${LISTINGS.filter(l=>l.seller===name).length} listing${LISTINGS.filter(l=>l.seller===name).length===1?"":"s"}</div></div></div>`;
}

/* =====================================================================
   PAGE FURNITURE VIEWS: side ad slots, bottom ticker, signatures
   ===================================================================== */
const adsOn = key => !LAYOUT.clean && LAYOUT[key];
const gambleOk = () => S.ageOk || signedIn();
const isExt = d => /^https?:\/\//.test(d || "");

/* ---------- Side slots: scheduled ads, rotated per slot ---------- */
const RAIL = {left:{i:0, timer:null, hover:false}, right:{i:0, timer:null, hover:false}, lastPath:null};
function slotAds(slotId){
  const live = SIDE_ADS.filter(a => a.slot === slotId && adStatus(a) === "Live" && (!a.gambling || gambleOk()) && (!a.aff || affById(a.aff)?.status === "active"));
  const paid = live.filter(a => !a.house);
  return paid.length ? paid : live;   // house ad only fills in when nothing paid is running
}
function railAdHtml(a, on){
  const l = a.aff ? affById(a.aff) : null;
  const inner = `<span class="ad-label">Sponsored · ${esc(a.advertiser)}</span>${a.img ? `<img src="${a.img}" alt="">` : ""}<h3>${esc(a.headline)}</h3>${a.text ? `<p>${esc(a.text)}</p>` : ""}
    <span class="ad-cta" style="background:${a.accent};color:${ctaInk(a.accent)}">${esc(a.cta)} ${l || isExt(a.dest) ? "↗" : "→"}</span>${a.gambling ? `<span class="ad-legal">18+ · Gamble responsibly · T&amp;Cs apply${l ? " · Affiliate link" : ""}</span>` : ""}`;
  const hidden = on ? "" : ' hidden aria-hidden="true" tabindex="-1"';
  if (l) return `<a class="rail-ad" href="${esc(affTracked(l, "side-slot"))}" data-act="affGo" data-id="${l.id}" data-p="side-slot" data-slot="${a.id}" style="background:${a.bg};color:${a.fg}" target="_blank" rel="sponsored nofollow noopener"${hidden}>${inner}</a>`;
  return `<a class="rail-ad" href="${isExt(a.dest) ? esc(a.dest) : "#"}" data-act="railClick" data-id="${a.id}" style="background:${a.bg};color:${a.fg}"${isExt(a.dest) ? ' target="_blank" rel="sponsored noopener"' : ""}${hidden}>${inner}</a>`;
}
function renderRails(){
  const newPage = RAIL.lastPath !== S.path; RAIL.lastPath = S.path;
  let any = false;
  SIDE_SLOTS.forEach(slot => {
    const el = $(slot.id === "left" ? "#railL" : "#railR"), st = RAIL[slot.id]; clearInterval(st.timer);
    const ads = adsOn("sideAds") && slot.on ? slotAds(slot.id) : [];
    if (!ads.length){ el.innerHTML = ""; return; }
    any = true;
    if (slot.rotate === "first") st.i = 0;
    else if (slot.rotate === "view" && newPage) st.i++;
    st.i = ((st.i % ads.length) + ads.length) % ads.length;
    el.innerHTML = `<div class="rail-rot" data-slot="${slot.id}">${ads.map((a, k) => railAdHtml(a, k === st.i)).join("")}${ads.length > 1 && slot.rotate === "time" ? `<div class="rail-dots" aria-hidden="true">${ads.map((a,k)=>`<i${k===st.i?' class="on"':""}></i>`).join("")}</div>` : ""}</div>`;
    if (newPage && el.offsetParent !== null) ads[st.i].imps++;   // count only when the slot is actually on screen
    if (slot.rotate === "time" && ads.length > 1){
      const root = el.firstElementChild;
      root.addEventListener("mouseenter", () => st.hover = true); root.addEventListener("mouseleave", () => st.hover = false);
      root.addEventListener("focusin", () => st.hover = true); root.addEventListener("focusout", () => st.hover = false);
      st.timer = setInterval(() => {
        if (st.hover || document.hidden || !document.body.contains(root)) return;
        st.i = (st.i + 1) % ads.length;
        [...root.querySelectorAll(".rail-ad")].forEach((n, k) => { const on = k === st.i; n.hidden = !on; on ? (n.removeAttribute("aria-hidden"), n.removeAttribute("tabindex")) : (n.setAttribute("aria-hidden","true"), n.setAttribute("tabindex","-1")); });
        [...root.querySelectorAll(".rail-dots i")].forEach((d, k) => d.classList.toggle("on", k === st.i));
        if (el.offsetParent !== null) ads[st.i].imps++;
      }, Math.max(4, slot.secs) * 1000);
    }
  });
  $("#layout").classList.toggle("has-rails", any);
  $("#layout").classList.toggle("right-only", any && !$("#railL").innerHTML);
}

/* ---------- Bottom ticker ---------- */
function tickerScores(){
  // Prototype: sample events. Production: the scores site's live feed.
  return EVENTS.filter(e => e.score && (e.status === "live" || (e.status === "finished" && Date.now() - e.at < 6*HR)))
    .map(e => ({kind:"score", e}));
}
function tickerItems(){
  const base = TICKER.items.filter(i => i.on && adStatus(i) === "Live" && (!i.gambling || gambleOk()));
  const scores = TICKER.scores ? tickerScores() : [];
  if (!scores.length) return base;
  // Drop the live scores in every few items, "now and then", rather than all the time
  const out = [], every = Math.max(1, TICKER.scoresEvery);
  base.forEach((it, i) => { out.push(it); if ((i + 1) % every === 0) out.push({kind:"scores", list:scores}); });
  if (base.length < every) out.push({kind:"scores", list:scores});
  return out;
}
function tickerItemHtml(it){
  if (it.kind === "scores") return it.list.map(({e}) => { const h = team(e.home), a = team(e.away);
    const tag = e.status === "live" ? `<span class="tk-tag live">Live ${esc(e.minute||"")}</span>` : `<span class="tk-tag ft">FT</span>`;
    return `<a class="tk-item" href="${esc(scoresUrl("/match/"+e.slug))}" target="_blank" rel="noopener" data-ext="scores">${tag}${esc(h.short || h.name)} <span class="tk-score">${e.score[0]}–${e.score[1]}</span> ${esc(a.short || a.name)}</a>`; }).join("");
  const tag = it.kind === "sponsored" ? '<span class="tk-tag ad">Ad</span>' : it.kind === "promo" ? '<span class="tk-tag">New</span>' : "";
  if (!it.dest) return `<span class="tk-item">${tag}${esc(it.text)}</span>`;
  return isExt(it.dest) ? `<a class="tk-item" href="${esc(it.dest)}" target="_blank" rel="${it.kind==="sponsored"?"sponsored ":""}noopener">${tag}${esc(it.text)}</a>`
                        : `<a class="tk-item" href="#" data-go="${esc(it.dest)}">${tag}${esc(it.text)}</a>`;
}
let tickerKey = "";
function renderTicker(force){
  const el = $("#ticker");
  const items = adsOn("ticker") ? tickerItems() : [];
  const key = JSON.stringify([items.map(i => i.kind === "scores" ? "s" : i.id), TICKER.speed, TICKER.label, SETTINGS.scoresUrl, SETTINGS.scoresUtm, gambleOk(), TICKER.items.map(i=>i.text+i.dest)]);
  if (!items.length){ el.hidden = true; el.innerHTML = ""; document.body.classList.remove("has-ticker"); tickerKey = ""; return; }
  if (!force && key === tickerKey) return;   // don't restart the crawl on every page change
  tickerKey = key;
  const run = items.map(tickerItemHtml).join("");
  el.hidden = false; document.body.classList.add("has-ticker");
  el.setAttribute("role", "region"); el.setAttribute("aria-label", "News ticker");
  el.innerHTML = `<span class="tk-label">${esc(TICKER.label)}</span>
    <div class="tk-view"><div class="tk-track" id="tkTrack"><span>${run}</span><span aria-hidden="true">${run.replace(/<a /g, '<a tabindex="-1" ')}</span></div></div>
    <button class="tk-btn" type="button" id="tkPause" aria-pressed="false" aria-label="Pause ticker" title="Pause">❚❚</button>`;
  // Constant speed regardless of how much text there is
  requestAnimationFrame(() => { const tr = $("#tkTrack"); if (!tr) return;
    const half = tr.scrollWidth / 2; tr.style.animationDuration = Math.max(20, half / (TICKER_SPEEDS[TICKER.speed] || 30)) + "s"; });
}
document.addEventListener("click", e => {
  const b = e.target.closest("#tkPause"); if (!b) return;
  const t = $("#ticker"), on = !t.classList.contains("paused");
  t.classList.toggle("paused", on); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Play ticker" : "Pause ticker"); b.title = on ? "Play" : "Pause"; b.textContent = on ? "▶" : "❚❚";
});
function renderChrome(){ renderRails(); renderTicker(); }

/* ---------- Signatures ---------- */
function sigHtml(sig){
  return esc(sig).replace(/\bhttps?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="nofollow ugc noopener">${u.replace(/^https?:\/\//,"")}</a>`);
}
function postSig(name){
  const u = USERS[name], viewer = me();
  if (!LAYOUT.signatures || !u || !u.sig || (viewer && viewer.hideSigs)) return "";
  return `<div class="sig">${sigHtml(u.sig)}</div>`;
}
const AVATAR_COLORS = ["#2A76B3","#0E7490","#15803D","#B45309","#BE185D","#7C3AED","#CA8A04","#334155"];
function avatarPanel(u){
  return `<section class="panel form" id="avatarPanel"><h3 class="ph">Avatar &amp; signature</h3>
    <div class="row" style="gap:14px;align-items:center">${av(u.name,"lg")}
      <div class="stack" style="gap:8px"><label class="btn small" style="display:inline-flex;flex-direction:row;cursor:pointer;font-weight:600">Upload a picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-change="avatarFile" id="avatarFile" style="position:absolute;opacity:0;width:1px;height:1px"></label>
        ${u.avatar ? `<button class="btn small ghost" type="button" data-act="avatarRemove">Remove picture</button>` : ""}
        <span class="hint">JPG, PNG, WebP or GIF, up to 5 MB. We crop it to a square.</span></div></div>
    ${u.avatar ? "" : `<div><span class="lbl">Or pick a colour for your initial</span><div class="row" style="gap:8px;margin-top:6px">${AVATAR_COLORS.map(c=>`<button type="button" class="swatch" style="background:${c}" data-act="avatarColor" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${u.avatarColor===c}"></button>`).join("")}</div></div>`}
    <form class="form" data-form="signature" style="gap:8px"><label for="sigBody">Signature <span class="hint">Shown under your forum posts. Up to 200 characters and 3 lines.</span></label>
      <textarea id="sigBody" name="sig" maxlength="200" style="min-height:70px" placeholder="e.g. Hearts of Oak till I die.">${esc(u.sig)}</textarea>
      ${restricted("links") ? `<p class="hint" style="margin:0">New members can't put links in a signature yet.</p>` : ""}
      <label class="chk"><input type="checkbox" name="hide" ${u.hideSigs?"checked":""}> Hide other members' signatures when I'm reading</label>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Save signature</button></div></form></section>`;
}

/* ---------- Admin: ad spots, ticker, clean look ---------- */
function aLayout(){
  const tog = (k, label, hint) => `<label class="chk"><input type="checkbox" data-change="layoutSet" data-k="${k}" id="lay-${k}" ${LAYOUT[k]?"checked":""} ${LAYOUT.clean && k!=="signatures"?"disabled":""}> ${label}${hint?` <span class="hint">${hint}</span>`:""}</label>`;
  const runs = a => `${a.start ? dday(a.start) : "Now"} – ${a.end ? dday(a.end) : "No end"}`;
  const statusPill = a => { const st = adStatus(a); return `<span class="pill ${st==="Live"?"green":st==="Scheduled"?"blue":st==="Paused"?"amber":""}">${st}</span>`; };
  const slotPanel = slot => { const ads = SIDE_ADS.filter(a => a.slot === slot.id), showing = slotAds(slot.id);
    return `<section class="panel flush" style="margin-bottom:16px"><div class="spread" style="padding:14px 16px;gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">${esc(slot.label)} <span class="pill ${slot.on?"green":""}">${slot.on?"On":"Off"}</span></h3>
        <span class="muted" style="font-size:.88rem">${slot.on ? `${showing.length} ad${showing.length===1?"":"s"} live now${showing.some(a=>a.house)?" (house ad filling in)":""}` : "Hidden on every page."} Shows on screens 1600px wide or more (1420px when only the right slot is on).</span></div>
        <div class="row"><button class="btn small${slot.on?"":" primary"}" type="button" data-act="slotToggle" data-id="${slot.id}">${slot.on?"Turn off":"Turn on"}</button><button class="btn small primary" type="button" data-act="sideAdEdit" data-slot="${slot.id}">Add ad</button></div></div>
      <div class="row" style="gap:14px;padding:0 16px 12px;flex-wrap:wrap;font-size:.92rem">
        <label class="row" style="gap:6px">Rotation <select class="inp" style="width:auto" data-change="slotRotate" data-id="${slot.id}" id="rot-${slot.id}">${[["time","Rotate every few seconds"],["view","New ad on each page view"],["first","Show the first live ad only"]].map(([k,t])=>`<option value="${k}" ${slot.rotate===k?"selected":""}>${t}</option>`).join("")}</select></label>
        <label class="row" style="gap:6px">every <input class="inp" type="number" min="4" max="60" style="width:70px" value="${slot.secs}" data-change="slotSecs" data-id="${slot.id}" id="secs-${slot.id}" ${slot.rotate==="time"?"":"disabled"}> seconds</label></div>
      <div class="tw"><table class="t"><thead><tr><th>Ad</th><th>Runs</th><th>Status</th><th class="n">Impressions</th><th class="n">Clicks</th><th class="n">CTR</th><th></th></tr></thead><tbody>
      ${ads.map(a => `<tr><td style="min-width:200px"><span class="row" style="gap:8px;flex-wrap:nowrap"><span style="flex:none;width:12px;height:32px;border-radius:3px;background:${a.bg};border:1px solid var(--line)"></span><span><strong>${esc(a.advertiser)}</strong>${a.house?' <span class="pill">House</span>':""}${a.gambling?' <span class="pill amber">18+</span>':""}${a.aff?' <span class="pill blue">Affiliate</span>':""}<div class="muted" style="font-size:.84rem">${esc(a.headline)}</div></span></span></td>
        <td style="font-size:.86rem;white-space:nowrap">${runs(a)}</td><td>${statusPill(a)}</td><td class="n">${fmt(a.imps)}</td><td class="n">${fmt(a.clicks)}</td><td class="n">${a.imps ? (a.clicks/a.imps*100).toFixed(2) : "0.00"}%</td>
        <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="sideAdEdit" data-id="${a.id}">Edit</button><button class="btn small ghost" type="button" data-act="sideAdPause" data-id="${a.id}">${a.paused?"Resume":"Pause"}</button>${a.house?"":`<button class="btn small ghost" type="button" data-act="sideAdDel" data-id="${a.id}">Delete</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No ads in this slot yet.</td></tr>`}
      </tbody></table></div></section>`; };
  const kinds = {news:"Announcement", promo:"Promo", sponsored:"Sponsored"};
  return `<section class="panel" style="margin-bottom:16px"><div class="spread" style="gap:12px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Clean look</h3>
      <span class="muted" style="font-size:.9rem">One switch hides every ad spot: side slots, the ad under the first post, the bottom ticker and the homepage banner. Turn it off to bring back whatever was on.</span></div>
      <button class="btn${LAYOUT.clean?" primary":""}" type="button" data-act="cleanLook" aria-pressed="${LAYOUT.clean}">${LAYOUT.clean?"Clean look is on":"Turn on clean look"}</button></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin-top:12px">
      ${tog("sideAds","Side ad slots","Wide screens only")}${tog("ticker","Bottom ticker")}${tog("homeBanner","Homepage banner")}${tog("postAds","Ad under the first post")}${tog("signatures","Member signatures under posts")}</div></section>
  ${postAdsAdmin()}
  ${SIDE_SLOTS.slice().sort((a,b)=>(b.on-a.on)).map(slotPanel).join("")}
  <section class="panel flush"><div class="spread" style="padding:14px 16px;gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Bottom ticker</h3><span class="muted" style="font-size:.88rem">Runs along the bottom of every page. Visitors can pause it, and it stops moving for anyone who has reduced motion turned on.</span></div>
      <button class="btn small primary" type="button" data-act="tickerEdit">Add item</button></div>
    <div class="row" style="gap:16px;padding:0 16px 12px;flex-wrap:wrap">
      <label class="row" style="gap:6px;font-size:.92rem">Speed <select class="inp" style="width:auto" data-change="tickerSpeed" id="tkSpeed">${Object.keys(TICKER_SPEEDS).map(k=>`<option value="${k}" ${TICKER.speed===k?"selected":""}>${k[0].toUpperCase()+k.slice(1)}</option>`).join("")}</select></label>
      <label class="row" style="gap:6px;font-size:.92rem">Label <input class="inp" style="width:140px" maxlength="20" value="${esc(TICKER.label)}" data-change="tickerLabel" id="tkLabel"></label>
      <label class="row" style="gap:6px;font-size:.92rem"><input type="checkbox" data-change="tickerScores" id="tkScores" ${TICKER.scores?"checked":""}> Show live scores</label>
      <label class="row" style="gap:6px;font-size:.92rem">every <select class="inp" style="width:auto" data-change="tickerEvery" id="tkEvery" ${TICKER.scores?"":"disabled"}>${[2,3,4,6].map(n=>`<option ${TICKER.scoresEvery===n?"selected":""}>${n}</option>`).join("")}</select> items</label></div>
    <p class="muted" style="font-size:.84rem;margin:0;padding:0 16px 12px">Live scores come from the scores site's feed and only show while matches are live or just finished. Each one links to the match on the scores site.</p>
    <div class="tw"><table class="t"><thead><tr><th>Item</th><th>Type</th><th>Links to</th><th>Runs</th><th>Status</th><th></th></tr></thead><tbody>
    ${TICKER.items.map((it, i) => `<tr><td style="min-width:220px">${esc(it.text)}${it.gambling?' <span class="pill amber">18+</span>':""}</td><td>${kinds[it.kind]}</td><td class="mono" style="font-size:.8rem;overflow-wrap:anywhere">${esc(it.dest||"—")}</td>
      <td style="font-size:.84rem;white-space:nowrap">${it.start||it.end ? `${it.start?dday(it.start):"Now"} – ${it.end?dday(it.end):"No end"}` : "Always"}</td>
      <td>${!it.on ? '<span class="pill">Off</span>' : adStatus(it)==="Live" ? '<span class="pill green">On</span>' : `<span class="pill ${adStatus(it)==="Scheduled"?"blue":""}">${adStatus(it)}</span>`}</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="tickerMove" data-i="${i}" data-d="-1" ${i===0?"disabled":""} aria-label="Move up">↑</button><button class="btn small ghost" type="button" data-act="tickerMove" data-i="${i}" data-d="1" ${i===TICKER.items.length-1?"disabled":""} aria-label="Move down">↓</button>
        <button class="btn small ghost" type="button" data-act="tickerEdit" data-id="${it.id}">Edit</button><button class="btn small ghost" type="button" data-act="tickerToggle" data-id="${it.id}">${it.on?"Turn off":"Turn on"}</button><button class="btn small ghost" type="button" data-act="tickerDel" data-id="${it.id}">Delete</button></td></tr>`).join("")}
    </tbody></table></div></section>`;
}

/* =====================================================================
   AFFILIATE LINKS (views) + AD UNDER THE FIRST POST
   ===================================================================== */
const affById = id => AFF_LINKS.find(l => l.id === +id);
const affTracked = (l, placement) => `/go/${l.slug}?p=${placement}`;
const affHost = l => l.url.replace(/^https?:\/\//, "").split(/[/?]/)[0];
// A tracked button. Clicks go through ACT.affGo, which logs the click before leaving.
function affButton(l, placement, label, cls="btn primary"){
  return `<a class="${cls}" href="${esc(affTracked(l, placement))}" data-act="affGo" data-id="${l.id}" data-p="${placement}" rel="sponsored nofollow noopener" target="_blank">${label} <span aria-hidden="true">↗</span></a>`;
}
const affNote = () => `<span class="aff-note">Affiliate link · we may earn a commission · 18+ · T&amp;Cs apply</span>`;

/* ---------- Ad under the first post ---------- */
function postAdFor(t){
  if (!adsOn("postAds")) return null;
  const cat = (board(t.board) || {}).cat;
  const ok = POST_ADS.filter(a => a.on && adStatus(a) === "Live" && (a.sections.includes("all") || a.sections.includes(cat)) && (!a.gambling || gambleOk())
    && (!a.aff || affById(a.aff)?.status === "active"));
  const paid = ok.filter(a => !a.house), pool = paid.length ? paid : ok;
  if (!pool.length) return null;
  if (LAYOUT.postAdRotate === "view"){ if (S.ui.postAdPath !== S.path){ S.ui.postAdPath = S.path; S.ui.postAdN = (S.ui.postAdN || 0) + 1; } return pool[(S.ui.postAdN || 0) % pool.length]; }
  return pool[t.id % pool.length];   // same ad on a topic, spread across topics
}
function postAd(t){
  const a = postAdFor(t); if (!a) return "";
  a.imps++;
  const l = a.aff ? affById(a.aff) : null;
  const cta = l ? `<a class="op-cta" href="${esc(affTracked(l, "post-ad"))}" data-act="affGo" data-id="${l.id}" data-p="post-ad" data-ad="${a.id}" rel="sponsored nofollow noopener" target="_blank" style="background:${a.accent};color:${ctaInk(a.accent)}">${esc(a.cta)} ↗</a>`
    : `<a class="op-cta" href="${isExt(a.dest) ? esc(a.dest) : "#"}" data-act="postAdClick" data-id="${a.id}" style="background:${a.accent};color:${ctaInk(a.accent)}"${isExt(a.dest) ? ' target="_blank" rel="sponsored noopener"' : ""}>${esc(a.cta)}${isExt(a.dest) ? " ↗" : " →"}</a>`;
  return `<aside class="op-ad" aria-label="Advertisement" style="background:${a.bg};color:${a.fg}">
    ${a.img ? `<img src="${a.img}" alt="">` : `<span class="op-ad-mark" style="background:${a.accent};color:${ctaInk(a.accent)}">${esc(a.advertiser[0])}</span>`}
    <div class="op-ad-copy"><span class="op-ad-label">${a.house ? "From Pitchside Forum" : `Sponsored · ${esc(a.advertiser)}`}</span><strong>${esc(a.headline)}</strong>${a.text ? `<p>${esc(a.text)}</p>` : ""}
      ${a.gambling ? `<span class="op-ad-legal">18+ · Gamble responsibly · T&amp;Cs apply${l ? " · Affiliate link" : ""}</span>` : ""}</div>
    ${cta}</aside>`;
}

/* ---------- Click stats ---------- */
function affStats(l, days){
  const since = Date.now() - days * DAY;
  const cl = AFF_CLICKS.filter(c => c.link === l.id && c.at >= since);
  const conv = l.conversions.filter(c => c.at >= since);
  const rev = conv.reduce((n, c) => n + c.amount, 0);
  return {clicks: cl.length, uniques: new Set(cl.map(c => c.visitor)).size, conv: conv.length, deposits: conv.filter(c=>c.event==="First deposit").length, rev,
    epc: cl.length ? rev / cl.length : 0, cr: cl.length ? conv.length / cl.length * 100 : 0, byPlace: cl.reduce((m, c) => (m[c.placement] = (m[c.placement] || 0) + 1, m), {})};
}

/* ---------- Admin → Affiliate links ---------- */
function aAffiliates(){
  const days = S.ui.affDays || 30, rows = AFF_LINKS.map(l => ({l, s: affStats(l, days)}));
  const tot = rows.reduce((t, {s}) => ({clicks:t.clicks+s.clicks, uniques:t.uniques+s.uniques, conv:t.conv+s.conv, rev:t.rev+s.rev}), {clicks:0, uniques:0, conv:0, rev:0});
  const places = Object.keys(AFF_PLACEMENTS);
  const forum = location.origin.startsWith("http") ? location.origin : "https://pitchside.example";
  return `<div class="spread" style="margin-bottom:14px;flex-wrap:wrap;gap:10px"><div class="tabs" role="group" aria-label="Date range" style="margin:0">${[7,30,90].map(d=>`<button type="button" data-act="affDays" data-d="${d}" aria-pressed="${days===d}">Last ${d} days</button>`).join("")}</div>
      <div class="row"><button class="btn small" type="button" data-act="affExport">Export clicks (CSV)</button><button class="btn small primary" type="button" data-act="affEdit">New affiliate link</button></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px">
      ${tile("Clicks", fmt(tot.clicks), `${fmt(tot.uniques)} unique visitors`)}${tile("Conversions", fmt(tot.conv), tot.clicks ? `${(tot.conv/tot.clicks*100).toFixed(1)}% of clicks` : "")}${tile("Commission", money(tot.rev), "reported by partners")}${tile("Earnings per click", "$" + (tot.clicks ? tot.rev/tot.clicks : 0).toFixed(2), "EPC")}</div>
    <section class="panel flush" style="margin-bottom:16px"><div class="tw"><table class="t"><thead><tr><th>Link</th><th>Tracked link</th><th class="n">Clicks</th><th class="n">Unique</th><th class="n">Conv.</th><th class="n">Conv. rate</th><th class="n">Commission</th><th class="n">EPC</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(({l, s}) => { const o = op(l.op); return `<tr><td style="min-width:200px"><strong>${esc(l.name)}</strong><div class="muted" style="font-size:.82rem">${o ? link(opPath(o), esc(o.name)) : "No operator"} · ${esc(l.network)} · ${esc(l.deal)}</div></td>
      <td><span class="mono" style="font-size:.8rem">/go/${esc(l.slug)}</span> <button class="btn small ghost" type="button" data-act="copyText" data-text="${esc(forum + "/go/" + l.slug)}">Copy</button></td>
      <td class="n">${fmt(s.clicks)}</td><td class="n">${fmt(s.uniques)}</td><td class="n">${fmt(s.conv)}</td><td class="n">${s.cr.toFixed(1)}%</td><td class="n">${money(s.rev)}</td><td class="n">$${s.epc.toFixed(2)}</td>
      <td><span class="pill ${l.status==="active"?"green":"amber"}">${l.status==="active"?"Active":"Paused"}</span>${o && o.blacklist ? ' <span class="pill red">Blacklisted</span>' : ""}</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="affEdit" data-id="${l.id}">Edit</button><button class="btn small ghost" type="button" data-act="affToggle" data-id="${l.id}">${l.status==="active"?"Pause":"Resume"}</button><button class="btn small ghost" type="button" data-act="affConv" data-id="${l.id}">Add conversions</button></td></tr>`; }).join("")}
    </tbody></table></div></section>
    <section class="panel flush" style="margin-bottom:16px"><div style="padding:14px 16px 0"><h3 class="ph">Clicks by placement</h3><p class="muted" style="margin:0 0 8px;font-size:.88rem">Where on Pitchside each click came from. The same placement is sent to the partner as the sub-ID.</p></div>
      <div class="tw"><table class="t"><thead><tr><th>Placement</th>${AFF_LINKS.map(l=>`<th class="n">${esc(op(l.op)?.name || l.name)}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
      ${places.map(p => { const vals = rows.map(({s}) => s.byPlace[p] || 0), sum = vals.reduce((a,b)=>a+b,0); return sum ? `<tr><td>${esc(AFF_PLACEMENTS[p])}</td>${vals.map(v=>`<td class="n">${fmt(v)}</td>`).join("")}<td class="n"><strong>${fmt(sum)}</strong></td></tr>` : ""; }).join("")}
      </tbody></table></div></section>
    <div class="cols half"><section class="panel"><h3 class="ph">Recent clicks</h3>${AFF_CLICKS.slice().sort((a,b)=>b.at-a.at).slice(0,8).map(c => `<div class="spread" style="padding:5px 0;border-top:1px solid var(--line);font-size:.88rem"><span>${esc(affById(c.link)?.name || "?")} <span class="muted">· ${esc(AFF_PLACEMENTS[c.placement]||c.placement)}</span></span><span class="muted">${c.user ? ulink(c.user) + " · " : ""}${rel(c.at)}</span></div>`).join("")}</section>
      <section class="panel"><h3 class="ph">How tracking works</h3><ol style="margin:0;padding-left:18px;font-size:.9rem;line-height:1.55">
        <li>Every affiliate button on Pitchside points at <span class="mono">/go/{link}</span> with the placement attached.</li>
        <li>That redirect logs the click (time, placement, page, anonymous visitor ID), then forwards to the partner with the placement filled into <span class="mono">{placement}</span> in your partner URL.</li>
        <li>Partners report sign-ups and deposits to our postback URL, or you enter them from their monthly report with <strong>Add conversions</strong>.</li></ol>
        <p style="margin:10px 0 4px;font-size:.88rem"><strong>Postback URL for partners</strong></p><div class="mono" style="font-size:.8rem;overflow-wrap:anywhere;background:var(--sunk);padding:8px;border-radius:6px">${esc(forum)}/api/aff/postback?link={link}&amp;sub={placement}&amp;event={event}&amp;amount={commission}&amp;key=…</div>
        <p class="muted" style="margin:8px 0 0;font-size:.82rem">Links to blacklisted operators pause automatically and can't be resumed. Affiliate deals never change the Safety Index or which reviews and complaints show.</p></section></div>`;
}

/* ---------- Admin → Ad spots: first-post ads ---------- */
const SECTION_NAMES = {all:"Every section", sports:"Sports", gambling:"Gambling", crypto:"Crypto", market:"Marketplace", community:"Community"};
function postAdsAdmin(){
  return `<section class="panel flush" style="margin-bottom:16px"><div class="spread" style="padding:14px 16px;gap:10px;flex-wrap:wrap"><div><h3 class="ph" style="margin:0 0 4px">Ad under the first post</h3>
      <span class="muted" style="font-size:.88rem">Shows directly under the opening post of every topic, on page 1 only. One ad per topic, picked from the ads that target that section. Paid ads go first; house ads fill in.</span></div>
      <div class="row"><label class="row" style="gap:6px;font-size:.9rem">Rotation <select class="inp" style="width:auto" data-change="postAdRotate" id="postAdRotate"><option value="topic" ${LAYOUT.postAdRotate!=="view"?"selected":""}>Same ad on a topic</option><option value="view" ${LAYOUT.postAdRotate==="view"?"selected":""}>New ad on each page view</option></select></label>
      <button class="btn small primary" type="button" data-act="postAdEdit">New ad</button></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Ad</th><th>Sections</th><th>Goes to</th><th>Runs</th><th class="n">Impressions</th><th class="n">Clicks</th><th class="n">CTR</th><th>Status</th><th></th></tr></thead><tbody>
    ${POST_ADS.map(a => { const l = a.aff ? affById(a.aff) : null;
      return `<tr><td style="min-width:200px"><strong>${esc(a.advertiser)}</strong>${a.house?' <span class="pill">House</span>':""}${a.gambling?' <span class="pill amber">18+</span>':""}<div class="muted" style="font-size:.85rem">${esc(a.headline)}</div></td>
      <td style="font-size:.85rem">${a.sections.map(s=>esc(SECTION_NAMES[s]||s)).join(", ")}</td>
      <td style="font-size:.82rem">${l ? `<span class="pill blue">Affiliate</span> /go/${esc(l.slug)}` : `<span class="mono">${esc(a.dest)}</span>`}</td>
      <td style="font-size:.84rem;white-space:nowrap">${a.house ? "Always" : `${dday(a.start)} – ${a.end ? dday(a.end) : "No end"}`}</td>
      <td class="n">${fmt(a.imps)}</td><td class="n">${fmt(a.clicks)}</td><td class="n">${a.imps ? (a.clicks/a.imps*100).toFixed(2) : "0.00"}%</td>
      <td>${!a.on ? '<span class="pill amber">Paused</span>' : `<span class="pill ${adStatus(a)==="Live"?"green":adStatus(a)==="Scheduled"?"blue":""}">${adStatus(a)}</span>`}</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="postAdEdit" data-id="${a.id}">Edit</button><button class="btn small ghost" type="button" data-act="postAdToggle" data-id="${a.id}">${a.on?"Pause":"Resume"}</button>${a.house?"":`<button class="btn small ghost" type="button" data-act="postAdDel" data-id="${a.id}">Delete</button>`}</td></tr>`; }).join("")}
    </tbody></table></div></section>`;
}

/* ---------- /go/{slug}: what a visitor sees for a moment while the redirect runs ---------- */
function vGo(slug, qs){
  const l = AFF_LINKS.find(x => x.slug === slug);
  if (!l || l.status !== "active") return `<section class="panel" style="max-width:520px;margin:30px auto;text-align:center"><h2 class="sec">This offer isn't available</h2><p>The link has ended or been paused.</p>${link("/casinos","See casinos & sportsbooks","btn primary")}</section>`;
  return `<section class="panel" style="max-width:520px;margin:30px auto;text-align:center"><h2 class="sec">Taking you to ${esc(affHost(l))}…</h2>
    <p class="muted">On the live site this is an instant redirect. The click has been counted.</p>${affNote()}</section>`;
}
/* =====================================================================
   VIEWS C: private messages, moderation, admin, settings, static pages
   ===================================================================== */

/* ---------- Private messages (§21) ----------
   One-to-one and group conversations between members, and between
   members and staff. Rules live in dmCheck() (views B). */
const isGroup = c => c.members.length > 2 || !!c.title;
const other = c => c.members.find(m => m !== S.user);
const hasStaff = c => c.members.some(m => m !== S.user && isStaffUser(m));
function convTitle(c){ return c.title || c.members.filter(m=>m!==S.user).join(", ") || "Just you"; }
function convBlocked(c){
  if (isGroup(c)) return (!can("pm") && !hasStaff(c)) ? (me().status !== "active" ? `Your account is ${me().status}. You can still message moderators and admins.` : `${roleLabel(S.role)} accounts can't message other members.`) : null;
  const o = other(c); if (!o) return "Everyone else has left this conversation.";
  const k = dmCheck(o); return k.ok ? null : k.why;
}
const lastMsgAt = c => c.msgs.length ? c.msgs[c.msgs.length-1].at : 0;

function vMessages(id){
  if (!signedIn()) return `<section class="panel" style="max-width:520px;margin:30px auto;text-align:center"><h2 class="sec">Messages</h2><p>Sign in to message other members, moderators and admins.</p><button class="btn primary" type="button" data-act="signIn">Sign in</button></section>`;
  const q = (S.ui.msgQ || "").toLowerCase();
  let convs = myConvs().sort((a,b)=>lastMsgAt(b)-lastMsgAt(a));
  const hits = c => q ? c.msgs.filter(m => m.body.toLowerCase().includes(q) || m.att.some(a=>a.name.toLowerCase().includes(q))).length : 0;
  if (q) convs = convs.filter(c => hits(c) || convTitle(c).toLowerCase().includes(q));
  const cur = id ? CONVS.find(c => c.id === +id && c.members.includes(S.user)) : null;
  if (cur) cur.read[S.user] = cur.msgs.length;
  const pmLeft = restricted("pm") ? Math.max(0, LIMITS.newPmsPerDay - counter("pm")) : null;

  const item = c => { const last = c.msgs[c.msgs.length-1], n = convUnread(c), staffConv = hasStaff(c) && !isStaff();
    return `<li><a class="conv" href="#" data-go="/messages/${c.id}"${cur===c?' aria-current="true"':""}>
      ${isGroup(c) ? `<span class="avatar" aria-hidden="true">${c.members.length}</span>` : av(other(c)||S.user)}
      <span class="c"><b>${esc(convTitle(c))}${staffConv?' <span class="pill amber" style="vertical-align:1px">Staff</span>':""}</b>
      <small>${q&&hits(c)?`${hits(c)} matching message${hits(c)>1?"s":""}`:last?`${last.from===S.user?"You: ":""}${esc(last.body.slice(0,60)||"📎 Attachment")}`:"No messages yet"}</small></span>
      ${n?`<span class="unread">${n}</span>`:last?`<small class="muted">${rel(last.at).replace(" ago","")}</small>`:""}</a></li>`; };

  let thread;
  if (!cur){
    thread = `<div class="thread"><div class="empty" style="margin:auto;max-width:380px">
      <h2 class="sec">Your messages</h2><p>Message any member directly, start a group, or get help from the moderators and admins.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" type="button" data-act="newMessage">Message a member</button>${!isStaff()?`<button class="btn" type="button" data-act="contactStaff" data-to="pick">Contact staff</button>`:""}</div></div></div>`;
  } else {
    const block = convBlocked(cur);
    const grp = isGroup(cur), o = !grp ? other(cur) : null;
    const head = grp
      ? `<div style="min-width:0"><strong>${esc(convTitle(cur))}</strong><div class="muted" style="font-size:.82rem">${cur.members.map(m=>m===S.user?"you":esc(m)+(isStaffUser(m)?" (staff)":"")).join(", ")}</div></div>
         <div class="row"><button class="btn small" type="button" data-act="convAdd" data-id="${cur.id}">Add people</button><button class="btn small" type="button" data-act="convRename" data-id="${cur.id}">Rename</button><button class="btn small ghost" type="button" data-act="convLeave" data-id="${cur.id}">Leave</button></div>`
      : `<div class="row">${av(o)}${ulink(o)}${roleBadge(o)}</div>
         <div class="row">${isStaff() && !isStaffUser(o) ? link("/members/"+o, "Profile & history", "btn small") : ""}<button class="btn small" type="button" data-act="block" data-user="${esc(o)}">${BLOCKS[S.user]?.has(o)?"Unblock":"Block"}</button><button class="btn small ghost" type="button" data-act="report" data-kind="user" data-user="${esc(o)}">Report user</button></div>`;
    const msgs = cur.msgs.map(m => { const mineMsg = m.from === S.user, hit = q && m.body.toLowerCase().includes(q);
      const style = [hit?"outline:2px solid var(--flood)":"", m.notice?"border:1px solid var(--flood);background:var(--flood-soft)":""].filter(Boolean).join(";");
      return `<div class="bubble${mineMsg?" mine":""}"${style?` style="${style}"`:""}>
        ${m.notice?`<div style="margin-bottom:4px"><span class="pill amber">Official moderator notice</span></div>`:""}
        <div class="bm"><span>${!mineMsg && (grp || isStaffUser(m.from)) ? `<strong>${esc(m.from)}</strong>${isStaffUser(m.from)?` · ${esc(roleLabel(USERS[m.from].role))}`:""} · `:""}${dstr(m.at)}${m.reported?' · <span class="pill red">Reported</span>':""}</span>
        <span class="row" style="gap:8px">${!mineMsg?`<button type="button" data-act="reportMsg" data-conv="${cur.id}" data-msg="${m.id}">Report</button>`:""}${mineMsg?`<button type="button" data-act="deleteMsg" data-conv="${cur.id}" data-msg="${m.id}">Delete</button>`:""}</span></div>
        ${m.body?`<div class="bt">${renderBody(m.body)}</div>`:""}${m.att.map(a=>`<div class="att">📎 ${esc(a.name)} <span class="muted">${esc(a.size)}</span></div>`).join("")}</div>`; }).join("")
      || `<div class="empty" style="margin:auto">Say hello.</div>`;
    const canNotice = mp("dm.notice") && cur.members.some(m => m !== S.user && !isStaffUser(m));
    const toStaffOnly = cur.members.filter(m => m !== S.user).every(isStaffUser);
    const foot = pmLeft !== null && !toStaffOnly ? `New member: ${pmLeft} of ${LIMITS.newPmsPerDay} messages to members left today. Messages to moderators and admins are unlimited.`
      : toStaffOnly && !isStaff() ? "You're messaging Pitchside staff. They usually reply within a day." : "Attachments: images, PDF, up to 10 MB each.";
    const composer = block ? `<div class="composer"><div class="notice amber" style="width:100%">${esc(block)}</div></div>`
      : `<form class="composer" data-form="sendMsg" data-conv="${cur.id}">
          <textarea name="body" id="msgBody" aria-label="Message" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"></textarea>
          <label class="btn" style="position:relative">Attach<input type="file" name="files" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer" data-change="attachPick"></label>
          <button class="btn primary" type="submit">Send</button>
          ${canNotice ? `<label class="row" style="gap:6px;font-size:.85rem;width:100%"><input type="checkbox" name="notice" id="noticeChk"> Send as an official moderator notice (logged in the audit trail)</label>` : ""}
          <div class="files" id="attNames">${foot}</div></form>`;
    thread = `<div class="thread"><div class="th"><button class="btn small back" type="button" data-go="/messages">← All</button>${head}</div><div class="tb" id="tb">${msgs}</div>${composer}</div>`;
  }
  return crumbs(["Messages"]) +
    `<section class="panel flush msgs${cur?" open":""}"><div class="list"><div class="lh">
      <div class="spread"><strong>Messages</strong><span class="row" style="gap:6px">${!isStaff()?`<button class="btn small" type="button" data-act="contactStaff" data-to="pick">Contact staff</button>`:""}<button class="btn small primary" type="button" data-act="newMessage">New</button></span></div>
      <input class="inp" type="search" placeholder="Search messages" value="${esc(S.ui.msgQ||"")}" data-input="msgQ" id="msgQ" aria-label="Search messages"></div>
      <ul>${convs.map(item).join("") || `<li class="empty">${q?"No conversations match.":"No conversations yet."}</li>`}</ul></div>${thread}</section>`;
}

/* ---------- Moderation (§32) ---------- */
// A report shows up if the moderator holds that queue's permission and, for board content, covers the board.
const queuePerm = id => id === "sellers" ? "seller.verify" : "queue." + id;
function reportVisible(r){ if (!mp(queuePerm(r.queue))) return false; return r.board ? canModBoard(r.board) : true; }
const HIDE_PERM = {post:"post.hide", topic:"topic.delete", review:"review.moderate", listing:"listing.remove", message:"queue.abuse"};
const suspendDays = () => isAdminUser(S.user) ? 30 : (modProfile(S.user).suspendMaxDays || 7);
function openReports(){ return REPORTS.filter(r => r.status === "open" && reportVisible(r)); }
function reportTarget(r){
  const t = r.target;
  if (r.kind === "post" || r.kind === "topic"){ const tp = topic(t.topic); if (!tp) return {h:"Deleted topic", ex:"", author:null};
    const p = t.post ? tp.posts.find(x=>x.id===t.post) : (r.kind==="post" ? tp.posts[tp.posts.length-1] : tp.posts[0]);
    return {h:link("/topic/"+tp.id, esc(tp.title)), ex:p?p.body:"", author:p?p.author:tp.author, hide:r.kind==="post"?"post":"topic"}; }
  if (r.kind === "review"){ const rv = REVIEWS.find(x=>x.id===t.review); return rv ? {h:link("/topic/"+rv.thread, `Review of ${esc(op(rv.op).name)}: ${esc(rv.title)}`), ex:rv.body, author:rv.user, hide:"review"} : {h:"Deleted review"}; }
  if (r.kind === "sellerVerify"){ const u = USERS[t.user]; return u ? {h:`${ulink(t.user)} wants to get verified`, ex:"", author:null, seller:t.user} : {h:"Deleted user"}; }
  if (r.kind === "escrowDispute"){ const e = escrowOf(t.escrow); const l = e && LISTINGS.find(x=>x.id===e.listing); return e ? {h:link("/escrow/"+e.id, `Escrow ${e.id}: ${esc(l?l.title:"")} · ${usd(e.amount)} ${e.token}`), ex:e.dispute ? e.dispute.detail : "", author:null, escrow:e} : {h:"Deleted deal"}; }
  if (r.kind === "listingApproval"){ const l = LISTINGS.find(x=>x.id===t.listing); return l ? {h:link("/topic/"+l.thread, `${esc(l.title)} · ${esc(l.price)}`), ex:`${l.cat}\n\n${l.desc}`, author:l.seller, approval:l} : {h:"Deleted listing"}; }
  if (r.kind === "listing"){ const l = LISTINGS.find(x=>x.id===t.listing); return l ? {h:link("/topic/"+l.thread, esc(l.title)), ex:l.desc, author:l.seller, hide:"listing"} : {h:"Deleted listing"}; }
  if (r.kind === "complaint") return {h:link("/complaints/"+t.complaint, t.complaint), ex:(COMPLAINTS.find(c=>c.id===t.complaint)||{}).statement, author:null};
  if (r.kind === "message"){ const c = CONVS.find(x=>x.id===t.conv), m = c && c.msgs.find(x=>x.id===t.msg); return {h:"Private message (reported content only)", ex:m?m.body:"(deleted)", author:m?m.from:null, hide:"message"}; }
  if (r.kind === "user") return {h:ulink(t.user), ex:"", author:t.user};
  if (r.kind === "claim") return {h:link(opPath(op(t.op)), `Claim: ${esc(op(t.op).name)}`), ex:`${t.user} wants to become the official representative.`, author:t.user, claim:true};
  if (r.kind === "appeal") return {h:ulink(t.user), ex:t.text, author:t.user, appeal:true};
  return {h:"Unknown", ex:""};
}
function vMod(){
  if (!isStaff()) return vMissing("The moderation queue is for moderators.");
  const qf = S.ui.mq2 || "all";
  const vis = REPORTS.filter(reportVisible);
  const open = vis.filter(r=>r.status==="open" && (qf==="all"||r.queue===qf)).sort((a,b)=>b.at-a.at);
  const done = vis.filter(r=>r.status!=="open").sort((a,b)=>b.closedAt-a.closedAt).slice(0,6);
  const myQueues = QUEUES.filter(q => mp(queuePerm(q.id)));
  const scope = modAllBoards() ? "All boards" : `Your boards: ${modBoardsOf(S.user).map(b=>esc(b.name)).join(", ") || "none assigned"}`;
  return crumbs(["Moderation"]) + phead("Moderation queue", scope + ". Every action needs a reason and is written to the audit log.", can("manageCategories")?link("/admin/audit","Full audit log","btn"):"") +
  `<div class="tabs"><button type="button" data-act="ui" data-k="mq2" data-v="all" aria-pressed="${qf==="all"}">All ${vis.filter(r=>r.status==="open").length}</button>${myQueues.map(q=>{const n = vis.filter(r=>r.status==="open"&&r.queue===q.id).length; return `<button type="button" data-act="ui" data-k="mq2" data-v="${q.id}" aria-pressed="${qf===q.id}">${q.label} ${n}</button>`;}).join("")}</div>
  <div class="cols"><div class="stack">${open.map(r=>{ const tg = reportTarget(r);
    return `<article class="panel"><div class="spread"><div class="row"><span class="pill ${r.queue==="spam"||r.queue==="abuse"?"red":"amber"}">${esc(QUEUES.find(q=>q.id===r.queue).label)}</span><strong>${tg.h}</strong></div><span class="muted" style="font-size:.85rem">${rel(r.at)}</span></div>
      ${tg.ex?`<blockquote style="margin:10px 0;padding:8px 12px;border-left:3px solid var(--line);background:var(--sunk);white-space:pre-wrap;overflow-wrap:anywhere">${esc(String(tg.ex).slice(0,300))}</blockquote>`:""}
      <div class="meta" style="margin-bottom:10px"><span>Reason: <strong style="color:var(--fg)">${esc(r.reason)}</strong></span><span>Reported by ${r.by==="system"?'<span class="pill blue">Automated</span>':ulink(r.by)}</span>${tg.author?`<span>Author ${ulink(tg.author)}</span>`:""}</div>
      ${tg.seller ? sellerReviewBody(tg.seller) : ""}
      <div class="row">${tg.seller ? (USERS[tg.seller].sellerVerif.status !== "pending" ? '<span class="muted" style="font-size:.88rem">Already decided.</span>' : mp("seller.verify") ? `<button class="btn small primary" type="button" data-act="sellerApprove" data-user="${esc(tg.seller)}">Verify</button><button class="btn small" type="button" data-act="sellerReject" data-user="${esc(tg.seller)}">Reject</button><button class="btn small ghost" type="button" data-act="dm" data-user="${esc(tg.seller)}">Message applicant</button>` : '<span class="muted" style="font-size:.88rem">Needs the verification permission.</span>') : tg.escrow ? (tg.escrow.status !== "disputed" ? '<span class="muted" style="font-size:.88rem">Already settled.</span>' : `${link("/escrow/"+tg.escrow.id, mp("escrow.arbitrate") ? "Open the case and decide" : "View the case", "btn small primary")}${mp("escrow.arbitrate")?"":'<span class="muted" style="font-size:.88rem">Needs the escrow-arbiter permission to decide.</span>'}<button class="btn small ghost" type="button" data-act="dm" data-user="${esc(tg.escrow.buyer)}">Message ${esc(tg.escrow.buyer)}</button><button class="btn small ghost" type="button" data-act="dm" data-user="${esc(tg.escrow.seller)}">Message ${esc(tg.escrow.seller)}</button>`) : tg.approval ? (mp("queue.listings") ? `<button class="btn small primary" type="button" data-act="approveListing" data-id="${tg.approval.id}">Approve</button><button class="btn small" type="button" data-act="rejectListing" data-id="${tg.approval.id}">Reject</button><button class="btn small ghost" type="button" data-act="dm" data-user="${esc(tg.author)}">Message ${esc(tg.author)}</button>` : '<span class="muted" style="font-size:.88rem">Needs the listing-approval permission.</span>') : tg.claim?`${mp("business.verify")?`<button class="btn small primary" type="button" data-act="resolve" data-id="${r.id}" data-op="approveClaim">Approve claim</button><button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="rejectClaim">Reject</button>`:'<span class="muted" style="font-size:.88rem">Needs the business-verification permission.</span>'}`
        : tg.appeal && !mp("user.appeals") ? '<span class="muted" style="font-size:.88rem">Needs the appeals permission.</span>' : tg.appeal?`<button class="btn small primary" type="button" data-act="resolve" data-id="${r.id}" data-op="upholdAppeal">Lift restriction</button><button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="denyAppeal">Deny appeal</button>`
        : `${tg.hide && mp(HIDE_PERM[tg.hide]||"post.hide")?`<button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="hide">Hide ${tg.hide}</button>`:""}
           ${tg.author && !isStaffUser(tg.author) ? `${mp("user.warn")?`<button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="warn">Warn author</button>`:""}${mp("user.suspend")?`<button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="suspend">Suspend ${suspendDays()} days</button>`:""}${mp("user.ban")?`<button class="btn small danger" type="button" data-act="resolve" data-id="${r.id}" data-op="ban">Ban</button>`:""}${tg.author!==S.user?`<button class="btn small ghost" type="button" data-act="dm" data-user="${esc(tg.author)}">Message author</button>`:""}`:""}
           <button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="resolveOnly">Mark resolved</button>`}
        ${tg.approval || tg.escrow || tg.seller ? "" : `<button class="btn small ghost" type="button" data-act="resolve" data-id="${r.id}" data-op="dismiss">Dismiss</button>`}</div></article>`; }).join("") || '<div class="panel empty">Queue clear.</div>'}</div>
  <aside class="stack"><section class="panel"><h3 class="ph">Your permissions</h3><p style="margin:0 0 6px"><strong>${isAdminUser(S.user)?"Admin (everything)":esc(modTemplate(S.user).name)}</strong></p>
      <p class="muted" style="margin:0 0 8px;font-size:.88rem">${scope}</p>
      ${isAdminUser(S.user)?"":`<details><summary style="cursor:pointer;font-size:.9rem">${modPerms(S.user).size} of ${ALL_MOD_KEYS.length} actions allowed</summary><ul style="margin:8px 0 0;padding-left:18px;font-size:.86rem">${ALL_MOD_KEYS.filter(k=>modPerms(S.user).has(k)).map(k=>`<li>${esc(modLabel(k))}</li>`).join("")}</ul></details>`}
      <p class="muted" style="margin:8px 0 0;font-size:.82rem">Admins set these under Admin → Moderators.</p></section>
    <section class="panel"><h3 class="ph">Find a member</h3><form data-form="userLookup" class="row"><input class="inp" style="flex:1;width:auto" name="u" list="aclist-users" placeholder="Username" aria-label="Username"><button class="btn small" type="submit">Open</button></form></section>
    <section class="panel"><h3 class="ph">Recently handled</h3>${done.map(r=>`<div style="padding:6px 0;border-top:1px solid var(--line);font-size:.9rem"><span class="pill ${r.status==="dismissed"?"":"green"}">${esc(r.status)}</span> ${esc(r.reason.slice(0,50))}<div class="muted">${ulink(r.closedBy)} · ${rel(r.closedAt)}</div></div>`).join("") || '<p class="muted" style="margin:0">Nothing yet.</p>'}</section>
    <section class="panel"><h3 class="ph">Your actions (audit log)</h3>${AUDIT.filter(a=>a.actor===S.user).slice(0,5).map(a=>`<div style="font-size:.88rem;padding:5px 0;border-top:1px solid var(--line)"><strong>${esc(a.action)}</strong> · ${esc(a.object)}<div class="muted">${esc(a.reason)} · ${rel(a.at)}</div></div>`).join("") || '<p class="muted" style="margin:0">None yet.</p>'}</section></aside></div>`;
}

/* ---------- Admin dashboard (§44) ---------- */
const ADMIN_TABS = [["overview","Overview"],["users","Users"],["moderators","Moderators"],["forum","Forum"],["permissions","Role permissions"],["sports","Sports"],["reviews","Reviews"],["businesses","Businesses"],["marketplace","Marketplace"],["advertising","Ads & affiliates"],["layout","Ad spots & ticker"],["affiliates","Affiliate links"],["seo","SEO"],["navigation","Navigation"],["audit","Audit log"],["system","System"]];
function vAdmin(tab="overview"){
  if (!can("manageCategories")) return vMissing("The admin dashboard is for admins.");
  if (tab === "system" && !can("system")) return crumbs(["Admin","/admin"],["System"]) + vMissing("System controls are limited to Super Admins.");
  const body = ({overview:aOverview, users:aUsers, moderators:aMods, forum:aForum, permissions:aPerms, sports:aSports, reviews:aReviews, businesses:aBiz, marketplace:aMarket, advertising:aAds, layout:aLayout, affiliates:aAffiliates, seo:aSeo, navigation:aNav, audit:aAudit, system:aSystem}[tab] || aOverview)();
  return crumbs(["Admin","/admin"],[ADMIN_TABS.find(t=>t[0]===tab)?.[1]||"Overview"]) + phead("Admin", "Configure the platform without a developer. Every change here is audited.") +
    `<div class="tabs">${ADMIN_TABS.filter(t=>t[0]!=="system"||can("system")).map(([k,v])=>`<a href="#" data-go="/admin/${k}" aria-pressed="${tab===k}">${v}</a>`).join("")}</div>${body}`;
}
function tile(label, value, sub=""){ return `<div class="panel"><div class="ph" style="margin-bottom:6px">${label}</div><div class="score" style="font-size:2rem">${value}</div>${sub?`<div class="muted" style="font-size:.82rem">${sub}</div>`:""}</div>`; }
function aOverview(){
  if (LIVE) return aOverviewLive();
  const res = COMPLAINTS.filter(c=>["Resolved","Partially Resolved"].includes(c.status)).length;
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px">
    ${tile("DAU / MAU","41.2k / 184k","22% stickiness")}${tile("New registrations","1,284","last 7 days")}${tile("Returning users","63%","of last week's actives")}
    ${tile("Posts today",fmt(11000+TOPICS.reduce((n,t)=>n+t.posts.length,0)),`${TOPICS.length} topics in sample`)}${tile("Open reports",openReports().length,"moderation workload")}
    ${tile("Complaint resolution",Math.round(res/COMPLAINTS.length*100)+"%",`${COMPLAINTS.length} cases`)}${tile("Affiliate clicks",fmt(AFF_CLICKS.filter(c=>c.at>Date.now()-30*DAY).length),"last 30 days")}${tile("Ad impressions",fmt(ADS.reduce((n,a)=>n+a.imps,0)),`${fmt(ADS.reduce((n,a)=>n+a.clicks,0))} clicks`)}</div>
  <div class="cols half"><section class="panel"><h3 class="ph">Launch funnel (sample)</h3>${[["Registered",100],["First post",58],["Second visit",47],["Followed something",39],["Returned in week 2",31]].map(([k,v])=>`<div class="bar2" style="grid-template-columns:150px minmax(0,1fr) 44px"><span>${k}</span><div class="track"><i style="width:${v}%"></i></div><span class="num" style="text-align:right">${v}%</span></div>`).join("")}</section>
  <section class="panel"><h3 class="ph">Most discussed teams</h3>${TEAMS.map(t=>({t,n:TOPICS.filter(x=>x.teams.includes(t.slug)).reduce((n,x)=>n+x.posts.length,0)})).filter(x=>x.n).sort((a,b)=>b.n-a.n).slice(0,6).map(x=>`<div class="spread" style="padding:4px 0">${link("/teams/"+x.t.slug, esc(x.t.name))}<span class="num muted">${x.n} posts</span></div>`).join("")}</section></div>`;
}
function aUsers(){
  return `<section class="panel flush"><div class="tw"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Status</th><th class="n">Warnings</th><th>Email</th><th></th></tr></thead><tbody>
  ${Object.values(USERS).map(u=>{ const lock = u.name===S.user || (u.role==="super_admin" && !can("system"));
    return `<tr><td>${ulink(u.name)}</td><td><select class="inp" style="width:auto;padding:4px 6px" data-change="setRole" data-user="${u.name}" ${lock?"disabled":""} aria-label="Role for ${esc(u.name)}">${ROLES.filter(r=>r.id!=="guest"&&(r.id!=="super_admin"||can("system"))).map(r=>`<option value="${r.id}" ${u.role===r.id?"selected":""}>${r.label}</option>`).join("")}</select></td>
    <td>${u.status==="active"?'<span class="pill green">Active</span>':`<span class="pill red">${esc(u.status)}</span>`}</td><td class="n">${u.warnings}</td><td>${u.verified?"Verified":'<span class="pill amber">Unverified</span>'}</td>
    <td>${lock?"":`<button class="btn small" type="button" data-act="userAction" data-user="${u.name}">Actions</button>`}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}
function aMods(){
  const staff = Object.values(USERS).filter(u => ["moderator","senior_moderator"].includes(u.role));
  const used = id => staff.filter(u => modProfile(u.name).template === id).length;
  return `<div class="notice" style="margin-bottom:14px"><strong>How it works.</strong><span>Each moderator gets a template (a bundle of permissions) and the boards they cover. You can then grant or remove single permissions for one person. Admins always have every permission. Changes apply immediately and are written to the audit log.</span></div>
  <section class="panel flush" style="margin-bottom:16px"><div class="spread" style="padding:14px 16px"><h3 class="ph" style="margin:0">Moderators</h3><button class="btn small primary" type="button" data-act="appointMod">Appoint a moderator</button></div><div class="tw"><table class="t"><thead><tr><th>Moderator</th><th>Template</th><th>Boards</th><th>Custom changes</th><th class="n">Max suspension</th><th></th></tr></thead><tbody>
  ${staff.map(u => { const p = modProfile(u.name), t = modTemplate(u.name), bs = modBoardsOf(u.name);
    const diff = [...p.allow].map(k=>`<span class="pill green" title="${esc(modLabel(k))}">+ ${esc(modLabel(k))}</span>`).concat([...p.deny].map(k=>`<span class="pill red" title="${esc(modLabel(k))}">− ${esc(modLabel(k))}</span>`));
    return `<tr><td><span class="row">${av(u.name)}${ulink(u.name)}</span><div class="muted" style="font-size:.8rem">${esc(roleLabel(u.role))}</div></td>
      <td><select class="inp" style="width:auto;padding:4px 6px" data-change="modTpl" data-user="${u.name}" id="mt-${u.name}" aria-label="Template for ${esc(u.name)}">${MOD_TEMPLATES.map(x=>`<option value="${x.id}" ${x.id===t.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></td>
      <td style="min-width:150px">${t.allBoards?'<span class="pill blue">All boards</span>':bs.map(b=>esc(b.name)).join(", ")||'<span class="muted">None</span>'}<div><button class="btn small ghost" type="button" data-act="modBoards" data-user="${u.name}" style="padding-inline:0">${t.allBoards?"View":"Edit boards"}</button></div></td>
      <td style="min-width:180px"><div class="row" style="gap:4px">${diff.join("")||'<span class="muted">None</span>'}</div><button class="btn small ghost" type="button" data-act="modCustom" data-user="${u.name}" style="padding-inline:0">Customize permissions</button></td>
      <td class="n"><input class="inp" style="width:70px" type="number" min="1" max="365" value="${p.suspendMaxDays}" data-change="modSusp" data-user="${u.name}" id="ms-${u.name}" aria-label="Max suspension days for ${esc(u.name)}"> days</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="dm" data-user="${u.name}">Message</button><button class="btn small ghost" type="button" data-act="removeMod" data-user="${u.name}">Remove</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">No moderators yet.</td></tr>`}</tbody></table></div></section>
  <section class="panel flush"><div class="spread" style="padding:14px 16px"><h3 class="ph" style="margin:0">Permission templates</h3><button class="btn small" type="button" data-act="editTpl">New template</button></div>
  <div class="tw"><table class="t"><thead><tr><th>Permission</th>${MOD_TEMPLATES.map(t=>`<th style="text-align:center;min-width:110px">${esc(t.name)}<div style="font-weight:400;text-transform:none;letter-spacing:0">${used(t.id)} assigned</div><div class="row" style="justify-content:center;gap:2px;margin-top:4px"><button class="btn small ghost" type="button" data-act="editTpl" data-id="${t.id}">Edit</button><button class="btn small ghost" type="button" data-act="copyTpl" data-id="${t.id}">Copy</button>${used(t.id)?"":`<button class="btn small ghost" type="button" data-act="delTpl" data-id="${t.id}">Delete</button>`}</div></th>`).join("")}</tr></thead><tbody>
    <tr><td><strong>Scope</strong></td>${MOD_TEMPLATES.map(t=>`<td style="text-align:center">${t.allBoards?"All boards":"Assigned boards"}</td>`).join("")}</tr>
    ${MOD_PERMS.map(g => `<tr><td colspan="${MOD_TEMPLATES.length+1}" style="background:var(--sunk);font-weight:700;font-size:.85rem">${esc(g.group)}</td></tr>` + g.keys.map(([k,l]) => `<tr><td>${esc(l)}</td>${MOD_TEMPLATES.map(t=>`<td style="text-align:center"><input type="checkbox" ${t.perms.has(k)?"checked":""} data-change="tplPerm" data-id="${t.id}" data-k="${k}" id="tp-${t.id}-${k.replace(".","-")}" aria-label="${esc(l)} in ${esc(t.name)}"></td>`).join("")}</tr>`).join("")).join("")}
  </tbody></table></div></section>`;
}
function aForum(){
  const cats = CATEGORIES.slice().sort((a,b)=>a.order-b.order);
  const ordered = []; cats.forEach(c => BOARDS.filter(b=>b.cat===c.id&&!b.parent).sort((a,b)=>a.order-b.order).forEach(b => { ordered.push(b); BOARDS.filter(x=>x.parent===b.slug).sort((a,c)=>a.order-c.order).forEach(x=>ordered.push(x)); }));
  const who = b => b.postRoles.length >= ALL_POSTERS.length ? "All members" : b.postRoles.every(r=>STAFF.includes(r)) ? "Staff only" : `${b.postRoles.length} roles`;
  return `<div class="cols lft320"><div class="stack">
    <section class="panel"><h3 class="ph">Categories <button class="btn small" type="button" data-act="addCat">Add</button></h3>${cats.map((c,i)=>`<div class="spread" style="padding:6px 0;border-top:1px solid var(--line)"><span>${esc(c.name)}${c.gated?' <span class="pill amber">18+</span>':""}</span><span class="row" style="gap:2px">
      <button class="btn small ghost" type="button" data-act="catMove" data-id="${c.id}" data-d="-1" ${i===0?"disabled":""} aria-label="Move up">↑</button><button class="btn small ghost" type="button" data-act="catMove" data-id="${c.id}" data-d="1" ${i===cats.length-1?"disabled":""} aria-label="Move down">↓</button>
      <button class="btn small ghost" type="button" data-act="catEdit" data-id="${c.id}">Edit</button><button class="btn small ghost" type="button" data-act="catDel" data-id="${c.id}">Delete</button></span></div>`).join("")}</section>
    <section class="panel"><h3 class="ph">Ranks</h3><p class="muted" style="font-size:.85rem;margin:0 0 8px">Minimum posts for each rank.</p>${RANKS.map((r,i)=>`<label class="spread" style="padding:3px 0;font-size:.92rem">${esc(r.name)}<input class="inp" style="width:90px" type="number" min="0" value="${r.min}" data-change="rank" data-i="${i}" ${i===0?"disabled":""} id="rank-${i}"></label>`).join("")}</section></div>
    <section class="panel flush"><div class="spread" style="padding:14px 16px"><h3 class="ph" style="margin:0">Boards</h3><button class="btn small primary" type="button" data-act="boardEdit">Add board</button></div><div class="tw"><table class="t"><thead><tr><th>Board</th><th>Category</th><th>Moderators</th><th>Who can post</th><th></th></tr></thead><tbody>
    ${ordered.map(b=>`<tr><td style="${b.parent?"padding-left:28px":""}">${b.parent?"↳ ":""}${link("/forum/"+b.slug, esc(b.name))}</td><td>${esc(CATEGORIES.find(c=>c.id===b.cat)?.name||"")}</td><td>${b.mods.map(esc).join(", ")||'<span class="muted">None</span>'}</td><td>${who(b)}${b.readRoles.length<ROLES.length?' · <span class="pill amber">Restricted read</span>':""}</td>
      <td style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="boardMove" data-slug="${b.slug}" data-d="-1" aria-label="Move up">↑</button><button class="btn small ghost" type="button" data-act="boardMove" data-slug="${b.slug}" data-d="1" aria-label="Move down">↓</button><button class="btn small" type="button" data-act="boardEdit" data-slug="${b.slug}">Edit</button><button class="btn small ghost" type="button" data-act="boardDel" data-slug="${b.slug}">Delete</button></td></tr>`).join("")}</tbody></table></div></section></div>`;
}
function aPerms(){
  const sym = {1:"✓", r:"Restricted", 0:"—"};
  return `<section class="panel flush" style="margin-bottom:16px"><div class="tw"><table class="t"><thead><tr><th>Capability</th>${ROLES.map(r=>`<th style="font-size:.66rem">${r.label}</th>`).join("")}</tr></thead><tbody>
    ${CAPS.map(c=>`<tr><td><strong>${esc(c.label)}</strong></td>${ROLES.map(r=>{ const v = PERMS[c.id][r.id];
      const lock = (c.id==="system" && !can("system")) || (["managePermissions","manageCategories"].includes(c.id) && ["admin","super_admin"].includes(r.id)) || (r.id==="guest" && c.id!=="read") || (c.id==="read");
      return `<td>${lock?`<span class="${v?"":"muted"}">${sym[v]}</span>`:`<select class="inp" style="width:auto;padding:3px 4px;font-size:.82rem" data-change="perm" data-cap="${c.id}" data-role="${r.id}" aria-label="${esc(c.label)} for ${r.label}"><option value="1" ${v===1?"selected":""}>✓</option><option value="r" ${v==="r"?"selected":""}>Restricted</option><option value="0" ${!v?"selected":""}>—</option></select>`}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></section>
  <section class="panel"><h3 class="ph">What "Restricted" means</h3><div class="row" style="gap:16px">
    <label class="lbl">Topics per day<input class="inp" style="width:100px" type="number" min="0" value="${LIMITS.newTopicsPerDay}" data-change="limit" data-k="newTopicsPerDay" id="lim1"></label>
    <label class="lbl">Messages per day (to others)<input class="inp" style="width:100px" type="number" min="0" value="${LIMITS.newPmsPerDay}" data-change="limit" data-k="newPmsPerDay" id="lim2"></label>
    <label class="lbl">Posts before links unlock<input class="inp" style="width:100px" type="number" min="0" value="${LIMITS.newMemberPostsToGraduate}" data-change="limit" data-k="newMemberPostsToGraduate" id="lim3"></label></div>
    <p class="muted" style="font-size:.85rem;margin:10px 0 0">Messages to moderators and admins never count toward these limits. Per-moderator powers live under Admin → Moderators. Admin rows that would lock admins out are fixed. Board-level overrides live under Forum.</p></section>`;
}
function aSports(){
  const lf = LEAGUES.some(l => l.slug === S.ui.admLeague) ? S.ui.admLeague : "all";
  const teams = TEAMS.filter(t => lf === "all" || t.league === lf || (t.also||[]).includes(lf));
  const logoField = (k, cur) => `<label>Logo <span class="hint">Optional. PNG or SVG with a transparent background works best.</span><input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" data-change="entLogo" data-k="${k}"></label>`;
  return `<section class="panel" style="margin-bottom:14px"><label class="chk" style="margin:0"><input type="checkbox" data-change="teamBadges" id="teamBadges" ${LAYOUT.teamBadges?"checked":""}> Show team badges and logos <span class="hint">Off for a cleaner look. Turn on once official logos are uploaded.</span></label></section>
  <div class="notice" style="margin-bottom:14px"><strong>Logos.</strong><span>Upload official club and league logos only where you have permission, for example from a club's media kit or a licensed sports data feed. Until then each team shows a badge in its colours with its short code.</span></div>
  <div class="cols half"><form class="panel form" data-form="addLeague"><h3 class="ph">Add a league or tournament</h3>
    <label>Name<input name="name" required placeholder="e.g. Eredivisie"></label>
    <div class="row"><label style="flex:1">Sport<select name="sport">${SPORTS.map(s=>`<option value="${s.slug}">${esc(s.name)}</option>`).join("")}</select></label>
      <label style="flex:1">Type<select name="type">${Object.entries(TYPE_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label></div>
    <div class="row"><label style="flex:1">Region<select name="region">${REGIONS.map(r=>`<option>${r}</option>`).join("")}</select></label><label style="flex:1">Country<input name="country" placeholder="e.g. Netherlands"></label><label style="flex:1">Season<input name="season" value="2026/27"></label></div>
    ${logoField("league")}
    <label class="chk"><input type="checkbox" name="board" checked> Create a discussion board for it</label><button class="btn primary" type="submit">Add league</button></form>
  <form class="panel form" data-form="addTeam"><h3 class="ph">Add a team</h3><label>Name<input name="name" required placeholder="e.g. Ajax"></label>
    <div class="row"><label style="flex:1">Short code<input name="short" maxlength="4" required placeholder="AJA"></label><label style="flex:1">Badge colour<input name="color" type="color" value="#2A76B3" style="height:40px"></label></div>
    <label>Main league<select name="league">${LEAGUES.map(l=>`<option value="${l.slug}">${esc(l.name)} (${esc(l.region)})</option>`).join("")}</select></label>
    <label>Also plays in <span class="hint">Cups and continental tournaments. Hold Ctrl or ⌘ to pick several.</span><select name="also" multiple size="4">${LEAGUES.filter(l=>l.type==="tournament").map(l=>`<option value="${l.slug}">${esc(l.name)}</option>`).join("")}</select></label>
    <div class="row"><label style="flex:1">Country<input name="country"></label><label style="flex:1">Ground<input name="stadium"></label><label style="flex:1">Founded<input name="founded" type="number" min="1800" max="2030"></label></div>
    ${logoField("team")}<button class="btn primary" type="submit">Add team</button></form></div>
  <form class="panel form row" data-form="addSport" style="margin-top:16px;align-items:flex-end;gap:10px"><label style="flex:1 1 220px">Add a sport<input name="name" required placeholder="e.g. Volleyball"></label><button class="btn" type="submit">Add sport</button></form>
  <section class="panel flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h3 class="ph">Leagues & tournaments (${LEAGUES.length})</h3></div><div class="tw"><table class="t"><thead><tr><th>League</th><th>Sport</th><th>Region</th><th class="n">Teams</th><th></th></tr></thead><tbody>
    ${REGIONS.flatMap(r => LEAGUES.filter(l=>l.region===r)).map(l=>`<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${leagueCrest(l,26)}${link("/leagues/"+l.slug, esc(l.name))}</span></td><td>${esc(sportOf(l.sport).name)}</td><td>${esc(l.region)}</td><td class="n">${teamsIn(l.slug).length}</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="entEdit" data-type="league" data-slug="${l.slug}">Edit</button><button class="btn small ghost" type="button" data-act="entDel" data-type="league" data-slug="${l.slug}">Delete</button></td></tr>`).join("")}</tbody></table></div></section>
  <section class="panel flush" style="margin-top:16px"><div class="spread" style="padding:14px 16px 0;gap:10px;flex-wrap:wrap"><h3 class="ph" style="margin:0">Teams (${teams.length})</h3>
      <label class="row" style="gap:6px;font-size:.9rem">Show <select class="inp" style="width:auto" data-change="admLeague" id="admLeague"><option value="all">All leagues</option>${LEAGUES.map(l=>`<option value="${l.slug}" ${lf===l.slug?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label></div>
    <div class="tw"><table class="t"><thead><tr><th>Team</th><th>Main league</th><th>Also in</th><th>Logo</th><th></th></tr></thead><tbody>
    ${teams.map(t=>`<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${crest(t,26)}${link("/teams/"+t.slug, esc(t.name))}</span></td><td>${esc(league(t.league)?.name||"—")}</td><td style="font-size:.85rem">${(t.also||[]).map(x=>esc(league(x)?.name||x)).join(", ")||"—"}</td>
      <td>${t.logo?'<span class="pill green">Uploaded</span>':'<span class="muted" style="font-size:.85rem">Badge</span>'}</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="entEdit" data-type="team" data-slug="${t.slug}">Edit</button><button class="btn small ghost" type="button" data-act="entDel" data-type="team" data-slug="${t.slug}">Delete</button></td></tr>`).join("")}</tbody></table></div></section>
  <div class="cols half" style="margin-top:16px"><section class="panel form"><h3 class="ph">Match thread automation</h3>
    <label>Create threads this many hours before kickoff<input class="inp" type="number" min="0" value="${SETTINGS.matchThreadLeadHrs}" data-change="setting" data-k="matchThreadLeadHrs" id="s1"></label>
    <label>Archive threads after (days)<input class="inp" type="number" min="1" value="${SETTINGS.archiveAfterDays}" data-change="setting" data-k="archiveAfterDays" id="s2"></label>
    <p class="muted" style="font-size:.85rem;margin:0">Duplicate automatic threads are prevented by linking each thread to its event.</p></section>
  <section class="panel"><h3 class="ph">Tags <button class="btn small" type="button" data-act="addTag">Add tag</button></h3>${TAGS.map((t,i)=>`<div class="spread" style="padding:5px 0;border-top:1px solid var(--line)">${link("/tag/"+t.slug,"#"+esc(t.name))}<label class="row" style="gap:6px;font-size:.88rem"><input type="checkbox" data-change="tagIndex" data-i="${i}" ${t.index?"checked":""} id="tag-${i}"> Indexed</label></div>`).join("")}</section></div>`;
}
function aReviews(){
  const labels = {reviews:"User reviews",quality:"Review quality",verified:"Verified reviews",resolution:"Complaint resolution",recency:"Recency",community:"Community reputation"};
  const sum = Object.values(WEIGHTS).reduce((a,b)=>a+b,0);
  const ssum = Object.values(SAFETY_W).reduce((a,b)=>a+b,0);
  return `<form class="panel form" data-form="safetyWeights" style="margin-bottom:16px"><h3 class="ph">Safety Index weights</h3>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">${Object.keys(SAFETY_W).map(k=>`<label>${SAFETY_LABELS[k]}<input class="inp" type="number" min="0" max="100" name="s_${k}" value="${SAFETY_W[k]}"></label>`).join("")}</div>
    <p class="${ssum===100?"muted":"err"}" style="margin:0">Total ${ssum}%. Must add up to 100. Unresolved complaints are penalised by amount and scaled by operator size; ignoring a case is the biggest penalty.</p>
    <div class="row">${OPERATORS.map(o=>`<span class="pill">${esc(o.name)} ${safety(o).score.toFixed(1)}</span>`).join("")}</div>
    <button class="btn primary" type="submit" style="align-self:flex-start">Save Safety Index weights</button></form>
  `+`<div class="cols half"><form class="panel form" data-form="weights"><h3 class="ph">Trust score weights</h3>
    ${Object.keys(WEIGHTS).map(k=>`<label class="spread" style="flex-direction:row;align-items:center">${labels[k]}<input class="inp" style="width:90px" type="number" min="0" max="100" name="${k}" value="${WEIGHTS[k]}"></label>`).join("")}
    <p class="${sum===100?"muted":"err"}" style="margin:0">Total ${sum}%. Must add up to 100.</p><button class="btn primary" type="submit">Save weights</button></form>
  <section class="panel"><h3 class="ph">Integrity checks</h3><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
    <li>One review per member per operator every 180 days</li><li>Operator representatives can't review their own business</li><li>Duplicate review text is flagged for moderators</li>
    <li>3+ one-star reviews in 48h flags possible review bombing</li><li>Reviewer reputation is weighted, so new account clusters move scores less</li></ul>
    <h3 class="ph" style="margin-top:16px">Current flags</h3>${OPERATORS.flatMap(o=>trust(o).flags.map(f=>`<div style="padding:4px 0">${link(opPath(o), esc(o.name))}: ${esc(f)}</div>`)).join("") || '<p class="muted" style="margin:0">No flags.</p>'}</section></div>`;
}
function aBiz(){
  const claims = REPORTS.filter(r=>r.kind==="claim"&&r.status==="open");
  return `<section class="panel" style="margin-bottom:16px"><h3 class="ph">Pending claims</h3>${claims.map(r=>`<div class="spread" style="padding:6px 0">${link(opPath(op(r.target.op)), esc(op(r.target.op).name))} · requested by ${ulink(r.target.user)}<span class="row"><button class="btn small primary" type="button" data-act="resolve" data-id="${r.id}" data-op="approveClaim">Approve</button><button class="btn small" type="button" data-act="resolve" data-id="${r.id}" data-op="rejectClaim">Reject</button></span></div>`).join("") || '<p class="muted" style="margin:0">No pending claims. Switch to Business Account and claim an unclaimed operator to try it.</p>'}</section>
  <section class="panel flush"><div class="tw"><table class="t"><thead><tr><th>Operator</th><th>Status</th><th>Representatives</th><th>Affiliate</th><th>Featured</th><th>Warning</th></tr></thead><tbody>
  ${OPERATORS.map(o=>`<tr><td>${link(opPath(o), esc(o.name))}</td><td><label class="row" style="gap:6px"><input type="checkbox" data-change="opFlag" data-slug="${o.slug}" data-k="verified" ${o.verified?"checked":""} ${o.claimed?"":"disabled"} id="v-${o.slug}"> Verified</label><span class="muted" style="font-size:.82rem">${o.claimed?"Claimed":"Unclaimed"}</span></td>
    <td>${o.reps.map(ulink).join(", ")||'<span class="muted">None</span>'}</td><td><input type="checkbox" data-change="opFlag" data-slug="${o.slug}" data-k="affiliate" ${o.affiliate?"checked":""} aria-label="Affiliate" id="a-${o.slug}"></td>
    <td><input type="checkbox" data-change="opFlag" data-slug="${o.slug}" data-k="featured" ${o.featured?"checked":""} aria-label="Featured" id="f-${o.slug}"></td><td>${warnBadge(o)||'<span class="muted">None</span>'}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function aMarket(){
  return `<div class="cols lft260"><section class="panel"><h3 class="ph">Categories</h3>${MARKET_CATS.map(c=>`<div style="padding:2px 0;font-size:.92rem">${esc(c)}</div>`).join("")}</section>
  <section class="panel flush"><div class="tw"><table class="t"><thead><tr><th>Listing</th><th>Posted by</th><th>Status</th><th>Featured</th><th></th></tr></thead><tbody>
  ${LISTINGS.map(l=>`<tr><td>${link("/topic/"+l.thread, esc(l.title))}${l.removed?' <span class="pill red">Removed</span>':""}${l.featureReq?' <span class="pill amber">Feature requested</span>':""}</td><td>${ulink(l.seller)}</td><td>${l.approval==="pending"?`<span class="pill amber">Awaiting approval</span> <button class="btn small primary" type="button" data-act="approveListing" data-id="${l.id}">Approve</button><button class="btn small ghost" type="button" data-act="rejectListing" data-id="${l.id}">Reject</button>`:l.approval==="rejected"?'<span class="pill red">Not approved</span>':statusPill(l.status)}</td>
    <td><input type="checkbox" data-change="listingFeat" data-id="${l.id}" ${l.featured?"checked":""} aria-label="Featured" id="lf-${l.id}"></td><td><button class="btn small ghost" type="button" data-act="removeListing" data-id="${l.id}">${l.removed?"Restore":"Remove"}</button></td></tr>`).join("")}</tbody></table></div>
  <p class="muted" style="padding:0 16px 12px;font-size:.85rem;margin:0">Every new or edited listing needs approval before it's public. Staff with the listing-approval permission skip the queue. Escrow disputes go to the Marketplace disputes queue.</p></section></div>` + aSellers() + aEscrow();
}
/* ---------- Home banner carousel ---------- */
const AD = {i:0, paused:false, hover:false, timer:null, list:[]};
function bannerStatus(b){ const n = Date.now(); return b.paused ? "Paused" : n < b.start ? "Scheduled" : n > b.end ? "Ended" : "Live"; }
// Gambling banners need a signed-in member or a confirmed 18+ visitor. The house ad always rotates last.
function eligibleBanners(){
  const okGamble = S.ageOk || signedIn();
  const live = BANNERS.filter(b => bannerStatus(b) === "Live" && (!b.gambling || okGamble));
  return live.filter(b => !b.house).concat(live.filter(b => b.house));
}
function adBanner(){
  const list = eligibleBanners(); if (!list.length) return "<div></div>";
  AD.list = list.map(b => b.id); if (AD.i >= list.length) AD.i = 0;
  return `<section class="ad" id="adBanner" aria-roledescription="carousel" aria-label="Sponsored banners"><div class="ad-stage">
    ${list.map((b,i) => { const on = i === AD.i, partner = b.partner && op(b.partner);
      return `<a class="ad-slide${on?" on":""}" href="#" data-act="adClick" data-id="${b.id}" style="background:${b.bg};color:${b.fg}" role="group" aria-roledescription="slide" aria-label="${i+1} of ${list.length}: ${esc(b.advertiser)}"${on?"":' aria-hidden="true" tabindex="-1"'}>
        <span class="ad-copy"><span class="ad-label">${b.house?"From Pitchside Forum":`Sponsored · ${esc(b.advertiser)}`}</span><h2>${esc(b.headline)}</h2><p>${esc(b.text)}</p>
          <span class="ad-cta" style="background:${b.accent};color:${ctaInk(b.accent)}">${esc(b.cta)} →</span>
          ${b.gambling?`<span class="ad-legal">18+ · Gamble responsibly · T&amp;Cs apply${partner && partner.affiliate ? " · Affiliate partner" : ""}</span>`:""}</span>
        ${b.img?`<img class="ad-img" src="${b.img}" alt="">`:""}</a>`; }).join("")}</div>
    ${list.length > 1 ? `<div class="ad-ctrls"><button class="nav" type="button" data-adnav="-1" aria-label="Previous banner">‹</button>${list.map((b,i)=>`<button class="ad-dot" type="button" data-adgo="${i}" aria-label="Show banner ${i+1}"${i===AD.i?' aria-current="true"':""}></button>`).join("")}<button class="nav" type="button" data-adnav="1" aria-label="Next banner">›</button><span class="spacer"></span>${link("/page/advertise","Advertise here","adtag")}<button class="nav" type="button" data-adpause aria-label="${AD.paused?"Play":"Pause"} banner rotation">${AD.paused?"▶":"❚❚"}</button></div>` : ""}
  </section>`;
}
function bannerRows(){
  return BANNERS.map(b => { const st = bannerStatus(b), ctr = b.imps ? (b.clicks/b.imps*100).toFixed(2) : "0.00";
    return `<tr><td><div style="display:flex;gap:10px;align-items:center;min-width:240px"><span style="flex:none;width:64px;height:40px;border-radius:6px;background:${b.bg};border:1px solid var(--line);display:grid;place-items:center;color:${b.fg};font-size:.6rem;font-weight:700;overflow:hidden;padding:2px;text-align:center;line-height:1.1">${esc(b.headline.slice(0,28))}</span><span><strong>${esc(b.advertiser)}</strong><div class="muted" style="font-size:.85rem">${esc(b.headline)}</div></span></div></td>
      <td><span class="pill ${st==="Live"?"green":st==="Paused"?"amber":""}">${st}</span>${b.gambling?' <span class="pill amber">18+</span>':""}${b.house?' <span class="pill">House</span>':""}</td>
      <td style="white-space:nowrap;font-size:.88rem">${dday(b.start)} – ${dday(b.end)}</td><td class="n">${fmt(b.imps)}</td><td class="n">${fmt(b.clicks)}</td><td class="n">${ctr}%</td>
      <td class="n" style="white-space:nowrap"><button class="btn small ghost" type="button" data-act="bannerEdit" data-id="${b.id}">Edit</button><button class="btn small ghost" type="button" data-act="bannerPause" data-id="${b.id}">${b.paused?"Resume":"Pause"}</button>${b.house?"":`<button class="btn small ghost" type="button" data-act="bannerDel" data-id="${b.id}">Delete</button>`}</td></tr>`; }).join("");
}
function aAds(){
  const live = BANNERS.filter(b=>bannerStatus(b)==="Live");
  return `<div class="notice" style="margin-bottom:14px"><strong>Rule.</strong><span>Commercial relationships are recorded and labelled, and never change community ratings.</span></div>
  <section class="panel flush" style="margin-bottom:16px"><div class="spread" style="padding:14px 16px"><div><h3 class="ph" style="margin:0 0 4px">Homepage banners</h3><span class="muted" style="font-size:.88rem">${live.length} live · rotates every <input class="inp" type="number" min="3" max="30" value="${SETTINGS.bannerSecs}" data-change="bannerSecs" id="bannerSecs" style="width:64px;display:inline-block;padding:3px 6px" aria-label="Seconds per banner"> seconds · pauses on hover</span></div>
    <button class="btn small primary" type="button" data-act="bannerEdit">New banner</button></div>
    <div class="tw"><table class="t"><thead><tr><th>Banner</th><th>Status</th><th>Runs</th><th class="n">Impressions</th><th class="n">Clicks</th><th class="n">CTR</th><th></th></tr></thead><tbody>${bannerRows()}</tbody></table></div>
    <p class="muted" style="font-size:.85rem;margin:0;padding:10px 16px 14px">Every banner is labelled Sponsored. Gambling banners carry an 18+ line and only show to signed-in members or visitors who confirmed their age. The house ad fills the slot when nothing else is live.</p></section>
  <section class="panel flush" style="margin-bottom:16px"><div style="padding:14px 16px 0"><h3 class="ph">Campaigns</h3></div><div class="tw"><table class="t"><thead><tr><th>Campaign</th><th>Placement</th><th>Targeting</th><th>Runs</th><th class="n">Impressions</th><th class="n">Clicks</th><th class="n">CTR</th></tr></thead><tbody>
  ${ADS.map(a=>`<tr><td>${esc(a.name)}</td><td>${esc(a.placement)}</td><td>${esc(a.target)}</td><td>${dday(a.start)} – ${dday(a.end)}</td><td class="n">${fmt(a.imps)}</td><td class="n">${fmt(a.clicks)}</td><td class="n">${(a.clicks/a.imps*100).toFixed(2)}%</td></tr>`).join("")}</tbody></table></div></section>
  <section class="panel"><div class="spread"><div><h3 class="ph" style="margin:0 0 4px">Affiliate links</h3><span class="muted" style="font-size:.88rem">${AFF_LINKS.filter(l=>l.status==="active").length} active · ${fmt(AFF_CLICKS.filter(c=>c.at>Date.now()-30*DAY).length)} clicks in the last 30 days</span></div>${link("/admin/affiliates","Open tracking","btn small primary")}</div></section>`;
}
function aSeo(){
  return `<section class="panel flush" style="margin-bottom:16px"><div class="tw"><table class="t"><thead><tr><th>Path</th><th>Meta title</th><th>Meta description</th><th>Index</th><th>Canonical</th></tr></thead><tbody>
  ${SEO.map((r,i)=>`<tr><td class="mono" style="font-size:.82rem;white-space:nowrap">${esc(r.path)}</td><td><input class="inp" value="${esc(r.title)}" data-change="seo" data-i="${i}" data-k="title" aria-label="Title for ${esc(r.path)}" id="seo-t-${i}"></td><td><input class="inp" value="${esc(r.desc)}" data-change="seo" data-i="${i}" data-k="desc" aria-label="Description for ${esc(r.path)}" id="seo-d-${i}"></td>
    <td><input type="checkbox" ${r.index?"checked":""} data-change="seo" data-i="${i}" data-k="index" aria-label="Index ${esc(r.path)}" id="seo-i-${i}"></td><td><input class="inp" value="${esc(r.canonical)}" data-change="seo" data-i="${i}" data-k="canonical" aria-label="Canonical for ${esc(r.path)}" id="seo-c-${i}"></td></tr>`).join("")}</tbody></table></div></section>
  <section class="panel"><h3 class="ph">Sitemap index (generated)</h3><div class="mono" style="font-size:.85rem;line-height:1.8">/sitemap-teams.xml · ${TEAMS.length} URLs<br>/sitemap-leagues.xml · ${LEAGUES.length} URLs<br>/sitemap-topics.xml · ${TOPICS.filter(t=>!t.deleted).length} URLs<br>/sitemap-operators.xml · ${OPERATORS.length} URLs<br>/sitemap-tags.xml · ${TAGS.filter(t=>t.index).length} URLs (noindex tags excluded)</div></section>`;
}
function aNav(){
  return `<section class="panel" style="max-width:560px"><h3 class="ph">Top navigation</h3>${NAV.map((n,i)=>`<div class="spread" style="padding:6px 0;border-top:1px solid var(--line)"><label class="row" style="gap:8px"><input type="checkbox" ${n.on?"checked":""} data-change="navOn" data-i="${i}" id="nav-${i}"><input class="inp" style="width:170px" value="${esc(n.label)}" data-change="navLabel" data-i="${i}" aria-label="Label" id="navl-${i}"><span class="muted mono" style="font-size:.8rem">${n.ext?"opens "+esc(scoresHost())+" ↗":n.children?"menu: "+n.children.map(c=>esc(c.label)).join(" · "):esc(n.path)}</span></label>
    <span class="row" style="gap:2px"><button class="btn small ghost" type="button" data-act="navMove" data-i="${i}" data-d="-1" ${i===0?"disabled":""} aria-label="Move up">↑</button><button class="btn small ghost" type="button" data-act="navMove" data-i="${i}" data-d="1" ${i===NAV.length-1?"disabled":""} aria-label="Move down">↓</button></span></div>`).join("")}</section>`;
}
function aAudit(){
  const who = S.ui.auditWho || "all";
  const rows = AUDIT.filter(a=>who==="all"||a.actor===who);
  return `<div class="tabs"><button type="button" data-act="ui" data-k="auditWho" data-v="all" aria-pressed="${who==="all"}">Everyone</button>${[...new Set(AUDIT.map(a=>a.actor))].map(a=>`<button type="button" data-act="ui" data-k="auditWho" data-v="${a}" aria-pressed="${who===a}">${esc(a)}</button>`).join("")}</div>
  <section class="panel flush"><div class="tw"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Object</th><th>Reason</th><th>Before → after</th></tr></thead><tbody>
  ${rows.map(a=>`<tr><td class="mono" style="font-size:.8rem;white-space:nowrap">${dstr(a.at)}</td><td>${ulink(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.object)}</td><td>${esc(a.reason)}</td><td class="mono" style="font-size:.8rem">${esc(a.prev??"—")} → ${esc(a.next??"—")}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function aSystem(){
  const forum = location.origin.startsWith("http") ? location.origin : "https://pitchside.example";
  return `<div class="cols half"><section class="panel form"><h3 class="ph">Live scores site</h3>
    <p class="muted" style="margin:0;font-size:.9rem">Live scores run on a separate site with its own data feed, so the forum never waits on the provider. Every "Live scores" link here opens it in a new tab.</p>
    <label>Address<input class="inp" type="url" value="${esc(SETTINGS.scoresUrl)}" data-change="setting" data-k="scoresUrl" id="scoresUrl" placeholder="https://scores.yourdomain.com"></label>
    <label class="chk"><input type="checkbox" ${SETTINGS.scoresUtm?"checked":""} data-change="scoresUtm" id="scoresUtm"> Tag links so you can see forum traffic in the scores site's analytics</label>
    <div><strong style="font-size:.9rem">Links the scores site should use back to the forum</strong>
      <dl class="kv" style="margin-top:6px;font-size:.85rem"><dt>Match discussion</dt><dd class="mono" style="overflow-wrap:anywhere">${esc(forum)}/events/{match}</dd><dt>Team fans</dt><dd class="mono" style="overflow-wrap:anywhere">${esc(forum)}/teams/{team}</dd><dt>League forum</dt><dd class="mono" style="overflow-wrap:anywhere">${esc(forum)}/leagues/{league}</dd><dt>Join</dt><dd class="mono" style="overflow-wrap:anywhere">${esc(forum)}/?join=1</dd></dl>
      <p class="hint" style="margin:6px 0 0">Use the same team, league and match slugs on both sites so these links line up.</p></div></section>
  <section class="panel form"><h3 class="ph">Compliance</h3><label class="chk"><input type="checkbox" ${SETTINGS.ageGate?"checked":""} data-change="ageGate" id="agegate"> Age gate on gambling sections</label>
    <label>Blocked domains<textarea class="inp" data-change="domains" id="domains" style="min-height:90px">${esc(SETTINGS.bannedDomains.join("\n"))}</textarea><span class="hint">One per line. Posts, DMs and listings containing these are rejected.</span></label></section>
  ${LIVE ? liveSystemPanels() : `<section class="panel"><h3 class="ph">Background jobs</h3>${[["Email","0 queued"],["Notifications","3 queued"],["Search indexing","idle"],["Image processing","idle"],["Sports ingestion",SETTINGS.providerOk?"every 30s":"failing, retrying"],["Match thread scheduler","next run in 4m"]].map(([k,v])=>`<div class="spread" style="padding:4px 0">${k}<span class="muted">${v}</span></div>`).join("")}</section>
  <section class="panel"><h3 class="ph">Backups</h3><dl class="kv"><dt>Last database backup</dt><dd>${dstr(Date.now()-14*MIN)}</dd><dt>Point-in-time recovery</dt><dd>On, 7 days</dd><dt>Object storage backup</dt><dd>${dstr(Date.now()-6*HR)}</dd><dt>Last restore test</dt><dd>${dday(Date.now()-12*DAY)}</dd><dt>RPO / RTO</dt><dd>15 min / 2 h</dd></dl></section>`}</div>`;
}

/* ---------- Settings ---------- */
function vSettings(){
  const u = me(); if (!u) return vMissing("Sign in to change settings.");
  const fol = [...(FOLLOWS[u.name]||[])], bm = [...(BOOKMARKS[u.name]||[])], bl = [...(BLOCKS[u.name]||[])];
  return crumbs(["Settings"]) + phead("Settings") + `<div class="cols half"><div class="stack">
  ${avatarPanel(u)}
  <form class="panel form" data-form="profile"><h3 class="ph">Profile</h3><label>About<textarea name="about">${esc(u.about)}</textarea></label><label>Website<input name="website" value="${esc(u.website)}"></label>
    <label>Favourite teams<select name="teams" multiple size="5">${TEAMS.map(t=>`<option value="${t.slug}" ${u.favTeams.includes(t.slug)?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label><button class="btn primary" type="submit">Save profile</button></form>
  <section class="panel form"><h3 class="ph">Privacy</h3><label>Who can send you private messages<select class="inp" data-change="privDms" id="privDms" ${isStaffUser(u.name)?"disabled":""}>${[["members","Any signed-in member"],["staff","Moderators and admins only"],["nobody","Nobody except staff"]].map(([v,t])=>`<option value="${v}" ${u.privacy.dms===v?"selected":""}>${t}</option>`).join("")}</select><span class="hint">${isStaffUser(u.name)?"Staff accounts always accept messages from members.":"Moderators and admins can always reach you, and you can always reach them."}</span></label>
    <label class="chk"><input type="checkbox" ${u.privacy.showActivity?"checked":""} data-change="privAct" id="privAct"> Show my recent activity on my profile</label></section>
  <section class="panel form"><h3 class="ph">Notifications</h3>${[["email","Email"],["browser","Browser"],["push","Push (mobile apps, later)"]].map(([k,t])=>`<label class="chk"><input type="checkbox" ${u.notify[k]?"checked":""} data-change="notify" data-k="${k}" id="n-${k}"> ${t}</label>`).join("")}</section>
  </div><div class="stack">
  ${LIVE ? liveSecurity(u) : `<section class="panel"><h3 class="ph">Security</h3><div class="spread"><span>Two-factor authentication</span><button class="btn small${u.twoFA?" on":""}" type="button" data-act="twoFA">${u.twoFA?"On":"Turn on"}</button></div>
    <h3 class="ph" style="margin-top:14px">Active sessions</h3>${[["Chrome on Windows · Accra","now"],["Pitchside app on Android · Accra","2h ago"]].map(([d,t])=>`<div class="spread" style="padding:4px 0;font-size:.92rem">${d}<span class="muted">${t}</span></div>`).join("")}<button class="btn small" type="button" data-act="logoutAll" style="margin-top:8px">Log out all other devices</button>
    <h3 class="ph" style="margin-top:14px">Login history</h3>${[["Today 07:12","Accra, GH","Chrome"],["Yesterday 22:40","Accra, GH","Android app"],["3 Oct 09:15","Kumasi, GH","Chrome"]].map(r=>`<div class="spread" style="font-size:.88rem;padding:3px 0"><span>${r[0]}</span><span class="muted">${r[1]} · ${r[2]}</span></div>`).join("")}</section>
  `}<section class="panel"><h3 class="ph">Following & bookmarks</h3>${fol.map(f=>{const [k,v]=f.split(":"); const t = k==="team"?team(v):k==="league"?league(v):topic(v); return t?`<div class="spread" style="padding:4px 0"><span><span class="pill">${k}</span> ${esc(t.name||t.title)}</span><button class="btn small ghost" type="button" data-act="follow" data-key="${f}">Unfollow</button></div>`:"";}).join("")||'<p class="muted" style="margin:0">Not following anything.</p>'}
    ${bm.map(id=>{const t = topic(id); return t?`<div class="spread" style="padding:4px 0"><span><span class="pill">bookmark</span> ${link("/topic/"+id, esc(t.title))}</span><button class="btn small ghost" type="button" data-act="bookmark" data-id="${id}">Remove</button></div>`:"";}).join("")}</section>
  <section class="panel"><h3 class="ph">Blocked members</h3>${bl.map(b=>`<div class="spread" style="padding:4px 0">${ulink(b)}<button class="btn small" type="button" data-act="block" data-user="${b}">Unblock</button></div>`).join("") || '<p class="muted" style="margin:0">You haven\'t blocked anyone.</p>'}</section>
  ${LIVE && !featureOn("escrow") ? "" : `<section class="panel form"><h3 class="ph">Payout wallets (escrow)</h3>
    <p class="muted" style="margin:0;font-size:.88rem">Where escrow payments for your sales are sent, and the default refund address when you buy. Stablecoins only.</p>
    <label>Tron address for USDT<input class="inp mono" id="wTron" data-change="payoutWallet" data-k="tron" value="${esc((u.wallets||{}).tron||"")}" placeholder="T…" spellcheck="false" autocomplete="off"></label>
    <label>Base / Polygon address for USDC<input class="inp mono" id="wEvm" data-change="payoutWallet" data-k="evm" value="${esc((u.wallets||{}).evm||"")}" placeholder="0x…" spellcheck="false" autocomplete="off"></label>
    <p class="hint muted" style="margin:0;font-size:.82rem">Double-check these. Payments sent to a wrong address can't be recovered.</p></section>
  `}${LIVE && !featureOn("verification") ? "" : `<section class="panel"><h3 class="ph">Marketplace verification</h3><p style="margin:0 0 8px">${vStatusPill(u.sellerVerif) || '<span class="muted">Not verified</span>'}</p>${link("/get-verified", u.sellerVerif.status==="verified" ? "View details" : u.sellerVerif.status==="pending" ? "Check status" : "Get verified", "btn small")}</section>
  `}<section class="panel"><h3 class="ph">Your data</h3><div class="row"><button class="btn" type="button" data-act="exportData">Export my data</button><button class="btn danger" type="button" data-act="deleteAccount">Delete account</button></div></section>
  </div></div>`;
}

/* ---------- Static / legal pages (§43) ---------- */
const PAGES = {
  rules:["House rules",["Argue the take, not the person.","No touting. Unlabelled affiliate links and “guaranteed tips” are removed.","Reviews must describe your own experience. One per operator every 180 days.","Scam accusations need evidence and stay labelled as allegations until moderators confirm a finding.","Marketplace: tickets at face value only. No account selling. No escrow is provided.","Crypto: disclose holdings when you promote a coin.","Report, don't retaliate. Every moderation action is logged and can be appealed."]],
  terms:["Terms of Service",["Draft placeholder. Final terms must be reviewed by qualified counsel for each jurisdiction Pitchside operates in."]],
  privacy:["Privacy Policy",["Draft placeholder. Covers data collected, retention, data export and deletion (available in Settings), and cookies."]],
  cookies:["Cookie controls",["Essential cookies keep you signed in. Analytics and advertising cookies are off until you opt in."]],
  gambling:["Gambling disclaimer",["Pitchside is a discussion forum, not a bookmaker or casino. Nothing here is betting advice. 18+ only. Gambling may be illegal where you live; check local law.","If gambling stops being fun, take a break and talk to someone you trust. See the Responsible Gambling board."]],
  disclosures:["Advertising & affiliate disclosures",["Some operators pay Pitchside a commission when members sign up. Those operators are labelled “Affiliate partner” on every page. Sponsored placements are labelled. Neither changes a trust score or which reviews are shown."]],
  dmca:["Copyright / DMCA",["To report copyrighted material, send the URL, a description of the work and your contact details. Draft placeholder pending legal review."]],
  advertise:["Advertise on Pitchside",["Reach sports fans across football, basketball, NFL, tennis and combat sports. The homepage banner rotates up to five advertisers, with impressions and clicks reported weekly.","Placements: homepage banner, board sidebar, sponsored topic, featured marketplace listing. Target by sport, league, country or device.","Gambling advertisers must hold a licence for the countries they target, and their ads carry 18+ and responsible-gambling notices. Operators with a confirmed scam finding can't advertise. Advertising never changes an operator's trust score.","To book, message the admin team through Contact staff at the bottom of any page."]],
  moderators:["Become a moderator",["Moderators are volunteers appointed by admins, one or more per board. You need 6+ months of membership and a clean record. Apply from the Help & Feedback board."]]
};
function vPage(k){ const p = PAGES[k]; if (!p) return vMissing("Page not found.");
  return crumbs([p[0]]) + phead(esc(p[0])) + `<section class="panel" style="max-width:70ch">${k==="rules"?`<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px">${p[1].map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`:p[1].map(x=>`<p>${esc(x)}</p>`).join("")}${k!=="rules"?'<p class="muted" style="font-size:.85rem">Legal text is a draft. Compliance is not guaranteed until reviewed by counsel.</p>':""}</section>`;
}

function aSellers(){
  const pend = Object.values(USERS).filter(u=>u.sellerVerif.status==="pending"), ver = Object.values(USERS).filter(u=>u.sellerVerif.status==="verified");
  return `<h2 class="sec" style="margin-top:22px">Marketplace verification</h2>
  <div class="cols half"><section class="panel"><h3 class="ph">Waiting for review (${pend.length})</h3>${pend.map(u=>`<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="spread">${ulink(u.name)}<span class="muted" style="font-size:.85rem">applied ${rel(u.sellerVerif.appliedAt)}</span></div>${sellerReviewBody(u.name)}
      ${mp("seller.verify")?`<div class="row"><button class="btn small primary" type="button" data-act="sellerApprove" data-user="${u.name}">Verify</button><button class="btn small" type="button" data-act="sellerReject" data-user="${u.name}">Reject</button></div>`:""}</div>`).join("") || '<p class="muted" style="margin:0">No applications waiting.</p>'}</section>
  <section class="panel flush"><div style="padding:14px 16px 0"><h3 class="ph">Verified members (${ver.length})</h3></div><div class="tw"><table class="t"><tbody>
    ${ver.map(u=>`<tr><td>${ulink(u.name)} ${sellerBadge(u.name,true)}</td><td class="muted" style="font-size:.88rem">since ${dday(u.sellerVerif.decidedAt)} · by ${esc(u.sellerVerif.by||"")}</td><td class="n">${mp("seller.verify")?`<button class="btn small ghost" type="button" data-act="sellerRevoke" data-user="${u.name}">Revoke</button>`:""}</td></tr>`).join("") || '<tr><td class="empty">None yet.</td></tr>'}</tbody></table></div>
    <p class="muted" style="padding:0 16px 12px;margin:0;font-size:.85rem">Requirements: email, phone, ID check, ${SELLER_RULES.minAgeDays}+ day old account, ${SELLER_RULES.minPosts}+ posts, no active warnings.</p></section></div>`;
}
/* =====================================================================
   ACTIONS, FORMS, ROUTER, INIT
   ===================================================================== */
const nav = path => { if (path !== S.path) S.hist.push(S.path); S.path = path; if (LIVE && location.pathname + location.search !== path) history.pushState({}, "", path); };
const roleChecks = roles => ROLES.map(r=>`<label class="chk" style="font-size:.88rem"><input type="checkbox" name="r_${r.id}" ${roles.includes(r.id)?"checked":""}> ${r.label}</label>`).join("");
const pickRoles = (f, prefix) => ROLES.map(r=>r.id).filter(id => f.elements[prefix+id] && f.elements[prefix+id].checked);
const filesOf = input => input && input.files ? [...input.files].map(x=>({name:x.name, size:x.size>1e6?(x.size/1e6).toFixed(1)+" MB":Math.max(1,Math.round(x.size/1e3))+" KB", bytes:x.size})) : [];
const tooBig = fs => fs.find(x=>x.bytes > 10e6);
const nextMsgId = c => c.msgs.reduce((m,x)=>Math.max(m,x.id),0)+1;

// Only messages to non-staff members count toward the New Member daily limit.
function postMessage(c, body, att, notice=false){
  c.msgs.push({id:nextMsgId(c), from:S.user, body, at:Date.now(), att, notice});
  c.read[S.user] = c.msgs.length;
  (S.ui.drafts||(S.ui.drafts={}))[c.id] = "";
  if (c.members.some(m => m !== S.user && !isStaffUser(m))) bump("pm");
  if (notice) audit("Moderator notice", `to ${c.members.filter(m=>m!==S.user).join(", ")}`, body.slice(0,80), "—", "sent");
  c.members.filter(m=>m!==S.user).forEach(m=>notify(m, notice?"moderator":"message", notice?`Official moderator notice from ${S.user}`:`${S.user} sent you a message${isGroup(c)?` in “${convTitle(c)}”`:""}`,"/messages/"+c.id));
}
function findDirect(o){ return CONVS.find(x=>x.members.length===2 && !x.title && x.members.includes(S.user) && x.members.includes(o)); }

function openNewMessage(to="", body=""){
  modal({title:"New message", submit:"Send", body:`
    <label>To<input name="to" value="${esc(to)}" list="aclist-users" placeholder="username, username…" autocomplete="off" required><span class="hint">One member for a direct message, or several (comma-separated) for a group.</span></label>
    <label>Group name <span class="hint">Optional, for 3+ people</span><input name="title"></label>
    <label>Message<textarea name="body">${esc(body)}</textarea></label>
    <label>Attachments<input type="file" name="files" multiple></label>`,
    onSubmit: f => {
      let names = [...new Set(val(f,"to").split(/[,\s]+/).map(s=>s.replace(/^@/,"").trim()).filter(Boolean))];
      const unknown = names.find(n=>!USERS[n]); if (unknown) return `There's no member called ${unknown}.`;
      const others = names.filter(n=>n!==S.user), body = val(f,"body"), att = filesOf(f.elements.files);
      if (!others.length) return "Add at least one member to send to.";
      if (!body && !att.length) return "Write a message or attach a file.";
      if (tooBig(att)) return `${tooBig(att).name} is over the 10 MB limit.`;
      for (const o of others){ const chk = dmCheck(o); if (!chk.ok) return chk.why; }
      if (body){ const pr = contentProblem(body); if (pr) return pr; }
      const title = val(f,"title");
      let c = others.length===1 && !title ? findDirect(others[0]) : null;
      if (!c){ c = {id:++convSeq, members:[S.user, ...others], title: others.length>1||title ? (title||null) : null, msgs:[], read:{}, kind: others.every(isStaffUser) ? "staff" : null}; CONVS.push(c); }
      postMessage(c, body, att); nav("/messages/"+c.id);
    }});
}

// Contact staff: a board's moderators, the admin team, or a moderator the member picks.
function openStaffConv(members, title, body){
  if (!signedIn()) return needSignIn("Sign in to contact staff.");
  const others = members.filter(m => m !== S.user);
  let c = others.length === 1 && !title ? findDirect(others[0])
        : CONVS.find(x => x.kind === "staff" && x.title === title && x.members.includes(S.user) && others.every(m => x.members.includes(m)));
  if (!c){ c = {id:++convSeq, members:[S.user, ...others], title: title||null, msgs:[], read:{}, kind:"staff"}; CONVS.push(c); }
  if (body) postMessage(c, body, []);
  go("/messages/"+c.id);
}
function staffPicker(preset){
  const staff = Object.values(USERS).filter(u => STAFF_ROLES.includes(u.role) && u.name !== S.user);
  const desc = u => isAdminUser(u.name) ? "Admin" : `${modTemplate(u.name).name}${modAllBoards(u.name)?" · all boards":modBoardsOf(u.name).length?" · "+modBoardsOf(u.name).map(b=>b.name).join(", "):""}`;
  modal({title:"Contact staff", submit:"Send", body:`
    <label>Who<select name="to"><option value="@admins">The admin team (all admins)</option>
      <optgroup label="Board moderators">${BOARDS.filter(b=>b.mods.length).map(b=>`<option value="@board:${b.slug}" ${preset==="board:"+b.slug?"selected":""}>Moderators of ${esc(b.name)}</option>`).join("")}</optgroup>
      <optgroup label="A specific person">${staff.map(u=>`<option value="${u.name}">${esc(u.name)} · ${esc(desc(u))}</option>`).join("")}</optgroup></select></label>
    <label>About<select name="about">${["Question about the rules","Problem with another member","Appeal a moderation decision","Business or partnership","Something else"].map(x=>`<option>${x}</option>`).join("")}</select></label>
    <label>Message<textarea name="body" required></textarea></label>
    <p class="hint" style="margin:0">Messages to staff never count toward New Member limits. To flag a specific post, use Report on the post instead.</p>`,
    onSubmit: f => {
      const to = val(f,"to"), body = val(f,"body"); if (body.length < 5) return "Write a short message so staff know how to help.";
      const text = `[${val(f,"about")}] ${body}`;
      closeModal();
      if (to === "@admins") return void openStaffConv(Object.values(USERS).filter(u=>isAdminUser(u.name)).map(u=>u.name), "Admin team", text);
      if (to.startsWith("@board:")){ const b = board(to.slice(7)); return void openStaffConv(b.mods, `${b.name} moderators`, text); }
      openStaffConv([to], null, text);
    }});
}

function openReport(kind, data){
  if (!signedIn()) return needSignIn("Sign in to report content.");
  modal({title:"Report", submit:"Send report", body:`<label>What's wrong?<select name="why">${["Spam","Abuse or harassment","Scam or fraud","Off-topic","Misinformation","Copyright","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label>
    <label>Details <span class="hint">Optional. Moderators see this.</span><textarea name="details" style="min-height:70px"></textarea></label>`,
    onSubmit: f => {
      const why = val(f,"why"), reason = why + (val(f,"details")?": "+val(f,"details"):"");
      const queue = why==="Spam"?"spam":why==="Scam or fraud"?"scam":kind==="listing"?"market":kind==="message"||why==="Abuse or harassment"?"abuse":"reports";
      const r = {id:++reportSeq, queue, kind, target:{}, board:null, reason, by:S.user, at:Date.now(), status:"open"};
      if (kind==="post"||kind==="topic"){ r.target = {topic:+data.topic, post:data.post?+data.post:null}; r.board = topic(data.topic).board; }
      if (kind==="review") r.target = {review:+data.id};
      if (kind==="listing") r.target = {listing:+data.id};
      if (kind==="message"){ r.target = {conv:+data.conv, msg:+data.msg}; const c = CONVS.find(x=>x.id===+data.conv); const m = c.msgs.find(x=>x.id===+data.msg); if (m) m.reported = true; }
      if (kind==="user") r.target = {user:data.user};
      REPORTS.push(r);
      toast("Reported. A moderator will review it.");
    }});
}

// One place for complaint status changes: system line, audit entry, notifications, deadline.
function setCaseStatus(c, status, reason, opts={}){
  const prev = c.status; c.status = status;
  if (status === "Awaiting Business") c.deadline = Date.now() + 7*DAY; else c.deadline = null;
  if (opts.recovered !== undefined) c.refunded = opts.recovered;
  const extra = opts.recovered ? ` · ${money(opts.recovered)} recovered` : "";
  c.messages.push(SYS(`Status → ${STATUS_LABEL[status]}${extra}`, Date.now()));
  if (!opts.quiet) audit(OPEN_STATUSES.includes(status) ? "Complaint status" : "Complaint decision", c.id, reason || "—", STATUS_LABEL[prev], STATUS_LABEL[status]);
  const o = op(c.op), who = new Set([c.user, ...o.reps, ...c.followers, c.specialist].filter(Boolean));
  who.forEach(u => notify(u, "complaint", `${c.id} (${o.name}) is now “${STATUS_LABEL[status]}”`, "/complaints/"+c.id));
}

/* ---------- Marketplace approval ---------- */
function queueListing(l, reason){
  l.approval = "pending"; l.rejectReason = null;
  REPORTS.filter(r=>r.kind==="listingApproval" && r.target.listing===l.id && r.status==="open").forEach(r=>{ r.status="dismissed"; r.closedBy="system"; r.closedAt=Date.now(); });
  REPORTS.push({id:++reportSeq, queue:"listings", kind:"listingApproval", target:{listing:l.id}, board:null, reason, by:"system", at:Date.now(), status:"open"});
}
function closeListingQueue(l, status){
  REPORTS.filter(r=>r.kind==="listingApproval" && r.target.listing===l.id && r.status==="open").forEach(r=>{ r.status=status; r.closedBy=S.user; r.closedAt=Date.now(); });
}

const ACT = {
  signOut(){ setRole("guest"); toast("Signed out"); go("/"); },
  signIn(){ modal({title:"Sign in", submit:"Sign in", body:`<label>Username or email<input name="u" autocomplete="username" value="kwame_fc"></label><label>Password<input name="p" type="password" autocomplete="current-password" value="demo-password"></label>
      <p class="hint" style="margin:0">Prototype: pick a demo account to see the site as a member, moderator, admin and so on. 2FA would be asked for here when enabled.</p>
      <label>Demo account<select name="role">${ROLES.filter(r=>r.id!=="guest").map(r=>`<option value="${r.id}" ${r.id==="member"?"selected":""}>${r.label} (${DEMO[r.id]})</option>`).join("")}</select></label>
      <p style="margin:0;font-size:.9rem"><a href="#" data-act="resetPw">Forgot password?</a></p>`,
      onSubmit: f => { setRole(val(f,"role")); toast("Signed in as " + S.user); }}); },
  register(){ modal({title:"Join Pitchside Forum", submit:"Create account", body:`<label>Username<input name="u" required></label><label>Email<input name="e" type="email" required></label><label>Password<input name="p" type="password" required minlength="8"><span class="hint">At least 8 characters.</span></label>
      <label class="chk"><input type="checkbox" name="age"> I'm 18 or older, or I'll stay out of the gambling sections</label><label class="chk"><input type="checkbox" name="tos"> I accept the Terms and Rules</label>
      <div class="notice" style="font-size:.85rem">Human check (Turnstile) would appear here. We'll email you a link to verify your address before you can post.</div>`,
      onSubmit: f => { const u = slugify(val(f,"u")).replace(/-/g,"_"); if (u.length<3) return "Pick a username with at least 3 letters or numbers."; if (USERS[u]) return "That username is taken.";
        if (!/^\S+@\S+\.\S+$/.test(val(f,"e"))) return "Enter a valid email address."; if (val(f,"p").length<8) return "Password needs at least 8 characters."; if (!f.elements.tos.checked) return "Accept the Terms to continue.";
        USERS[u] = U(u,"new_member",{joined:Date.now(),posts:0,topics:0,likes:0,rep:{forum:0,market:0,review:0,prediction:null},verified:false});
        DEMO.new_member = u; setRole("new_member"); toast(`Welcome, ${u}. Check your email to verify.`); }}); },
  resetPw(){ modal({title:"Reset password", submit:"Send reset link", body:`<label>Email<input name="e" type="email"></label>`, onSubmit:()=>{ toast("If that email has an account, a reset link is on its way."); }}); },

  newTopic(el){
    if (!signedIn()) return needSignIn("Sign in to start a topic.");
    const kb = el.dataset.board && board(el.dataset.board);
    if (kb && kb.kind === "review") return ACT.writeReview({dataset:{type:kb.opType}});
    if (kb && kb.kind === "listing") return ACT.newListing({dataset:{cat:kb.mcat}});
    const opts = BOARDS.filter(b => canPostBoard(b) && !b.kind);
    if (!opts.length) return toast(`${roleLabel(S.role)} accounts can't start topics.`);
    if (restricted("topic") && counter("topic") >= LIMITS.newTopicsPerDay) return toast(`New members can start ${LIMITS.newTopicsPerDay} topics a day.`);
    const pre = el.dataset.board || (el.dataset.cat && (opts.find(b=>b.cat===el.dataset.cat)||{}).slug);
    modal({title:"New topic", submit:"Post topic", body:`
      <label>Board<select name="board">${opts.map(b=>`<option value="${b.slug}" ${b.slug===pre?"selected":""}>${b.parent?"↳ ":""}${esc(b.name)}</option>`).join("")}</select></label>
      <label>Title<input name="title" maxlength="140" required></label><label>Post<textarea name="body" required></textarea></label>
      <label>Team <span class="hint">Optional. Links the topic to the team page.</span><select name="team"><option value="">None</option>${TEAMS.map(t=>`<option value="${t.slug}" ${t.slug===el.dataset.team?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>
      <fieldset style="border:0;padding:0;margin:0"><legend class="lbl" style="margin-bottom:4px">Tags</legend><div class="row">${TAGS.map(t=>`<label class="chk" style="font-size:.88rem"><input type="checkbox" name="tag_${t.slug}"> ${esc(t.name)}</label>`).join("")}</div></fieldset>
      <details><summary style="cursor:pointer;font-weight:600">Add a poll</summary><div class="form" style="margin-top:8px"><label>Question<input name="pq"></label><label>Options <span class="hint">One per line</span><textarea name="po" style="min-height:70px"></textarea></label>
        <label class="chk"><input type="checkbox" name="pm"> Allow multiple choices</label><label class="chk"><input type="checkbox" name="pp" checked> Show results before voting</label><label>Closes in (days)<input name="pd" type="number" min="1" value="3"></label></div></details>
      ${restricted("topic")?`<p class="hint" style="margin:0">New member: ${LIMITS.newTopicsPerDay - counter("topic")} topics left today, no links yet.</p>`:""}`,
      onSubmit: f => {
        const title = val(f,"title"), body = val(f,"body");
        if (title.length < 8) return "Give the topic a title of at least 8 characters.";
        const pr = contentProblem(body) || contentProblem(title+" ."); if (pr) return pr;
        const tags = TAGS.filter(t=>f.elements["tag_"+t.slug].checked).map(t=>t.slug);
        const b = board(val(f,"board")), tm = val(f,"team");
        const lg = LEAGUES.find(l=>l.board===b.slug || l.board===b.parent);
        const t = T(++topicSeq, b.slug, title, S.user, Date.now(), [P(S.user, body, Date.now())], {tags, teams:tm?[tm]:[], league:lg?lg.slug:(tm?team(tm).league:null)});
        const opts2 = val(f,"po").split("\n").map(s=>s.trim()).filter(Boolean);
        if (val(f,"pq") && opts2.length >= 2) t.poll = {q:val(f,"pq"), multi:f.elements.pm.checked, publicResults:f.elements.pp.checked, closes:Date.now()+Math.max(1,+val(f,"pd")||3)*DAY, options:opts2.map(x=>({t:x, v:new Set()}))};
        else if (val(f,"pq")) return "A poll needs at least two options.";
        TOPICS.unshift(t); bump("topic"); me().topics++; me().posts++;
        (body.match(/@([a-z0-9_]+)/gi)||[]).forEach(m=>notify(m.slice(1),"mention",`${S.user} mentioned you in “${title}”`,"/topic/"+t.id));
        Object.entries(FOLLOWS).forEach(([u,set])=>{ if (tm && set.has("team:"+tm)) notify(u,"follow",`New topic for ${team(tm).name}: “${title}”`,"/topic/"+t.id); });
        nav("/topic/"+t.id);
      }});
  },
  page(el){ S.ui.pages = S.ui.pages||{}; S.ui.pages[el.dataset.key] = +el.dataset.p; render(); window.scrollTo(0,0); },
  boardTag(el){ S.ui["tag:"+el.dataset.board] = el.dataset.tag; S.ui.pages = Object.assign(S.ui.pages||{}, {["b:"+el.dataset.board]:1}); render(); },
  tab(el){ S.ui[el.dataset.key] = el.dataset.v; render(); },
  ui(el){ S.ui[el.dataset.k] = el.dataset.v; render(); },
  follow(el){ if (!signedIn()) return needSignIn("Sign in to follow."); const s = FOLLOWS[S.user] = FOLLOWS[S.user]||new Set(); const k = el.dataset.key;
    s.has(k) ? s.delete(k) : s.add(k); toast(s.has(k)?"Following. You'll get notifications.":"Unfollowed"); render(); },
  bookmark(el){ const s = BOOKMARKS[S.user] = BOOKMARKS[S.user]||new Set(); const id = +el.dataset.id; s.has(id)?s.delete(id):s.add(id); toast(s.has(id)?"Bookmarked":"Bookmark removed"); render(); },
  addPoll(el){ const t = topic(el.dataset.id);
    modal({title:"Add a poll", submit:"Add poll", body:`<label>Question<input name="pq" required></label><label>Options <span class="hint">One per line</span><textarea name="po"></textarea></label><label class="chk"><input type="checkbox" name="pm"> Allow multiple choices</label><label class="chk"><input type="checkbox" name="pp" checked> Show results before voting</label><label>Closes in (days)<input name="pd" type="number" min="1" value="3"></label>`,
      onSubmit: f => { const o = val(f,"po").split("\n").map(s=>s.trim()).filter(Boolean); if (!val(f,"pq")||o.length<2) return "Add a question and at least two options.";
        t.poll = {q:val(f,"pq"), multi:f.elements.pm.checked, publicResults:f.elements.pp.checked, closes:Date.now()+(+val(f,"pd")||3)*DAY, options:o.map(x=>({t:x,v:new Set()}))}; }}); },
  modTopic(el){
    const t = topic(el.dataset.id), opn = el.dataset.op;
    if (opn==="pin"||opn==="lock"||opn==="archive"){ const k = {pin:"pinned",lock:"locked",archive:"archived"}[opn];
      return askReason(`${t[k]?"Un":""}${opn==="archive"?"archive":opn} topic`, r => { audit(`${t[k]?"Un":""}${opn} topic`, `topic #${t.id}`, r, t[k]?k:"not "+k, t[k]?"not "+k:k); t[k] = !t[k]; }); }
    if (opn==="move") return askReason("Move topic", (r,f) => { const to = f.elements.to.value, from = t.board; t.board = to; audit("Move topic",`topic #${t.id}`,r,from,to); },
      {extra:`<label>Move to<select name="to">${BOARDS.filter(b=>b.slug!==t.board).map(b=>`<option value="${b.slug}">${esc(b.name)}</option>`).join("")}</select></label>`});
    if (opn==="merge") return askReason("Merge into another topic", (r,f) => { const dst = topic(f.elements.to.value);
        dst.posts = dst.posts.concat(t.posts).sort((a,b)=>a.at-b.at); t.deleted = true; t.mergedInto = dst.id; audit("Merge topics",`topic #${t.id} → #${dst.id}`,r,`${t.posts.length} posts`,`merged`); nav("/topic/"+dst.id); },
      {extra:`<label>Target topic<select name="to">${TOPICS.filter(x=>x.id!==t.id&&!x.deleted).map(x=>`<option value="${x.id}">#${x.id} ${esc(x.title.slice(0,60))}</option>`).join("")}</select></label>`});
    if (opn==="tags") return modal({title:"Edit tags", body:`<div class="row">${TAGS.map(x=>`<label class="chk"><input type="checkbox" name="tag_${x.slug}" ${t.tags.includes(x.slug)?"checked":""}> ${esc(x.name)}</label>`).join("")}</div>`,
      onSubmit: f => { const prev = t.tags.join(","); t.tags = TAGS.filter(x=>f.elements["tag_"+x.slug].checked).map(x=>x.slug); audit("Edit tags",`topic #${t.id}`,"Tag update",prev||"none",t.tags.join(",")||"none"); }});
    if (opn==="delete") return askReason("Delete topic", r => { t.deleted = true; audit("Deleted topic",`topic #${t.id} “${t.title}”`,r,"visible","deleted"); nav("/forum/"+t.board); }, {danger:true, submit:"Delete"});
  },
  like(el){ const t = topic(el.dataset.topic), p = t.posts.find(x=>x.id===+el.dataset.post);
    if (p.likes.has(S.user)) p.likes.delete(S.user); else { p.likes.add(S.user); notify(p.author,"like",`${S.user} liked your post in “${t.title}”`,"/topic/"+t.id); if (USERS[p.author]) USERS[p.author].likes++; }
    render(); },
  quote(el){ const t = topic(el.dataset.topic), p = t.posts.find(x=>x.id===+el.dataset.post), ta = $("#replyBody"); if (!ta) return;
    const clean = p.body.replace(/\[quote=[\s\S]*?\[\/quote\]/g,"").trim();
    ta.value += `[quote=${p.author}]${clean}[/quote]\n`; ta.focus(); ta.dataset.quoted = p.author; ta.scrollIntoView({block:"center"}); },
  mention(el){ const ta = $("#replyBody"); if (!ta) return; ta.value += `@${el.dataset.user} `; ta.focus(); ta.scrollIntoView({block:"center"}); },
  report(el){ openReport(el.dataset.kind, el.dataset); },
  reportMsg(el){ openReport("message", el.dataset); },
  editPost(el){ const t = topic(el.dataset.topic), p = t.posts.find(x=>x.id===+el.dataset.post);
    modal({title:"Edit post", body:`<label>Post<textarea name="body" style="min-height:160px">${esc(p.body)}</textarea></label><p class="hint" style="margin:0">Previous versions stay in the edit history.</p>`,
      onSubmit: f => { const b = val(f,"body"); const pr = contentProblem(b); if (pr) return pr; if (b===p.body) return;
        p.revisions.push({at:Date.now(), body:p.body, by:S.user}); p.body = b;
        if (t.posts[0] === p && t.review){ const r = REVIEWS.find(x=>x.id===t.review); r.history.push({at:Date.now(), stars:r.stars, body:r.body}); r.body = b; }
        if (t.posts[0] === p && t.listing){ const l = LISTINGS.find(x=>x.id===t.listing); l.desc = b;
          if (!mp("queue.listings") && l.approval !== "pending"){ const was = l.approval; queueListing(l, was === "rejected" ? "Resubmitted after rejection" : "Listing edited after approval"); toast(was === "rejected" ? "Resubmitted for approval" : "Edits saved. The listing is hidden until a moderator re-approves it."); } }
        if (p.author!==S.user) audit("Edited content",`post #${p.id} in topic #${t.id}`,"Moderator edit","previous revision","edited"); }}); },
  history(el){ const t = topic(el.dataset.topic), p = t.posts.find(x=>x.id===+el.dataset.post);
    modal({title:"Edit history", submit:null, cancel:"Close", body:`<div class="stack" style="gap:10px">${p.revisions.slice().reverse().map(r=>`<div class="panel"><div class="meta">${dstr(r.at)} · replaced by ${ulink(r.by)}</div><div style="white-space:pre-wrap">${esc(r.body)}</div></div>`).join("")}<div class="panel"><div class="meta">Current</div><div style="white-space:pre-wrap">${esc(p.body)}</div></div></div>`}); },
  hidePost(el){ const t = topic(el.dataset.topic), p = t.posts.find(x=>x.id===+el.dataset.post);
    askReason(p.hidden?"Unhide post":"Hide post", r => { audit(p.hidden?"Unhide post":"Hide post",`post #${p.id} in topic #${t.id}`,r,p.hidden?"hidden":"visible",p.hidden?"visible":"hidden"); p.hidden = !p.hidden; if (p.hidden) notify(p.author,"moderator",`A moderator hid your post in “${t.title}”: ${r}`,"/topic/"+t.id); }); },
  split(el){ const t = topic(el.dataset.topic), i = t.posts.findIndex(x=>x.id===+el.dataset.post);
    askReason("Split into a new topic", (r,f) => { const moved = t.posts.splice(i); const nt = T(++topicSeq, t.board, f.elements.title.value.trim()||"Split: "+t.title, moved[0].author, moved[0].at, moved, {teams:t.teams, league:t.league});
      TOPICS.unshift(nt); audit("Split topic",`topic #${t.id}`,r,`${t.posts.length+moved.length} posts`,`#${t.id}: ${t.posts.length}, #${nt.id}: ${moved.length}`); nav("/topic/"+nt.id); },
      {extra:`<p class="muted" style="margin:0">Moves this post and the ${t.posts.length-i-1} after it into a new topic.</p><label>New topic title<input name="title" required></label>`}); },
  predict(el){ if (!signedIn()) return needSignIn("Sign in to predict."); (PREDICTIONS[el.dataset.slug] = PREDICTIONS[el.dataset.slug]||{})[S.user] = el.dataset.v; toast("Prediction saved"); render(); },
  createMatchThread(el){ const e = EVENTS.find(x=>x.slug===el.dataset.slug), h = team(e.home), a = team(e.away), l = league(e.league);
    if (e.thread) return toast("A match thread already exists for this event.");
    const t = T(++topicSeq, l.board, `${h.name} vs ${a.name}: match thread`, S.user, Date.now(), [P(S.user, `Match thread. ${h.name} vs ${a.name} · ${l.name} · ${dstr(e.at)}.\nKeep it civil, keep it about the game.`, Date.now())], {pinned:true, auto:true, tags:["match-thread"], teams:[e.home,e.away], league:l.slug, event:e.slug});
    TOPICS.unshift(t); e.thread = t.id; audit("Create match thread",`event ${e.slug}`,"Manual creation","none",`topic #${t.id}`);
    Object.entries(FOLLOWS).forEach(([u,s])=>{ if (s.has("team:"+e.home)||s.has("team:"+e.away)) notify(u,"follow",`Match thread is up: ${h.name} vs ${a.name}`,"/topic/"+t.id); });
    nav("/topic/"+t.id); render(); },
  ageOk(){ S.ageOk = true; render(); },
  cBoard(el){ S.ui.cBoard = el.dataset.k; if (S.ui.pages) delete S.ui.pages.crypto; render(); },
  lgSportChip(el){ S.ui.lgRegion = "all"; go(el.dataset.k === "all" ? "/sports" : "/sports/" + el.dataset.k); },
  lgRegion(el){ S.ui.lgRegion = el.dataset.k; render(); },
  gSec(el){ S.ui.gSec = el.dataset.k; if (S.ui.pages) delete S.ui.pages.gambling; render(); },
  gTab(el){ S.ui.gTab = el.dataset.k; if (S.ui.pages) delete S.ui.pages.gambling; render(); },
  dirSet(el){ S.ui.dir = S.ui.dir||{}; S.ui.dir[el.dataset.k] = el.type==="checkbox" ? el.checked : el.dataset.v; if (el.dataset.k==="type") nav("/gambling"); render(); },

  writeReview(el){
    if (!signedIn()) return needSignIn("Sign in to post a review.");
    if (!can("review") || S.role === "business") return toast(S.role === "business" ? "Business accounts can't post reviews." : `${roleLabel(S.role)} accounts can't post reviews yet.`);
    const fixed = el.dataset.slug ? op(el.dataset.slug) : null, type = el.dataset.type;
    if (fixed && fixed.reps.includes(S.user)) return toast("You can't review a business you represent.");
    if (fixed){ const mine = myReview(fixed); if (mine) { toast(`You've already reviewed ${fixed.name}. Opening your review.`); return nav("/topic/" + mine.thread); } }
    const choices = OPERATORS.filter(o => !type || o.type === type);
    modal({title: fixed ? `Review ${fixed.name}` : "Post a review", submit:"Post review", body:`
      ${fixed ? "" : `<label>Operator<select name="op">${choices.map(o=>`<option value="${o.slug}">${esc(o.name)} · ${o.type}</option>`).join("")}</select><span class="hint">Not listed? Ask in Sportsbooks or Casino and a moderator will add it.</span></label>`}
      ${starPicker(+el.dataset.stars || 0)}
      <label>Topic title<input name="title" maxlength="100" required placeholder="e.g. Fast USDT payouts, slow support"></label>
      <label>Your experience<textarea name="body" required placeholder="What happened with deposits, withdrawals, support, KYC… This becomes the first post of the topic."></textarea></label>
      <details><summary style="cursor:pointer;font-weight:600">Category scores (optional)</summary><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:8px">${REVIEW_CATS.map(k=>`<label style="font-size:.85rem">${k}<select name="c_${k}"><option value="">Same as overall</option>${[5,4,3,2,1].map(n=>`<option>${n}</option>`).join("")}</select></label>`).join("")}</div></details>
      ${can("verifiedReview")?`<label>Transaction ID <span class="hint">Optional. Marks this a verified-transaction review.</span><input name="tx"></label>`:`<p class="hint" style="margin:0">Your review will show as unverified. Trusted members and verified reviewers can attach transaction proof.</p>`}`,
      onSubmit: f => {
        const o = fixed || op(val(f,"op"));
        if (o.reps.includes(S.user)) return "You can't review a business you represent.";
        if (REVIEWS.some(r=>r.op===o.slug && r.user===S.user && r.status!=="removed" && Date.now()-r.at < 180*DAY)) return `You've reviewed ${o.name} in the last 180 days. Edit that review instead.`;
        const body = val(f,"body"), title = val(f,"title");
        if (!val(f,"stars")) return "Choose a rating from 1 to 5 stars.";
        if (title.length < 6) return "Give the topic a clearer title.";
        if (body.length < 30) return "Write at least 30 characters so the review is useful.";
        const pr = contentProblem(body); if (pr) return pr;
        const dupe = REVIEWS.some(r=>r.body.trim().toLowerCase()===body.toLowerCase());
        const st = +val(f,"stars");
        const status = can("verifiedReview") ? (val(f,"tx") ? "verified transaction" : "verified user") : "unverified";
        const r = {id:++reviewSeq, op:o.slug, user:S.user, stars:st, scores:Object.fromEntries(REVIEW_CATS.map(k=>[k, +f.elements["c_"+k].value || st])), title, body, status, helpful:new Set(), unhelpful:new Set(), at:Date.now(), response:null, history:[]};
        REVIEWS.push(r); me().rep.review += 1; me().posts++; me().topics++;
        const t = threadFor(r, "review");
        if (dupe) REPORTS.push({id:++reportSeq, queue:"review_disputes", kind:"review", target:{review:r.id}, board:null, reason:"Duplicate review text detected", by:"system", at:Date.now(), status:"open"});
        o.reps.forEach(u=>notify(u,"review",`New ${r.stars}★ review of ${o.name}: “${title}”`,"/topic/"+t.id));
        nav("/topic/"+t.id); toast("Review posted"); }}); },
  rvote(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id); const up = el.dataset.v==="up";
    const a = up?r.helpful:r.unhelpful, b = up?r.unhelpful:r.helpful; b.delete(S.user); a.has(S.user)?a.delete(S.user):a.add(S.user); render(); },
  editReview(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id);
    modal({title:"Edit review", body:`<label>Rating<select name="stars">${[5,4,3,2,1].map(n=>`<option value="${n}" ${r.stars===n?"selected":""}>${stars(n)} ${n}</option>`).join("")}</select></label><label>Review<textarea name="body">${esc(r.body)}</textarea></label><p class="hint" style="margin:0">The previous version stays visible in the edit history.</p>`,
      onSubmit: f => { r.history.push({at:Date.now(), stars:r.stars, body:r.body}); r.stars = +val(f,"stars"); r.body = val(f,"body");
        const tp = topic(r.thread); if (tp && tp.posts[0].body !== r.body){ tp.posts[0].revisions.push({at:Date.now(), body:tp.posts[0].body, by:S.user}); tp.posts[0].body = r.body; } }}); },
  reviewHistory(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id);
    modal({title:"Review history", submit:null, cancel:"Close", body:r.history.slice().reverse().map(h=>`<div class="panel"><div class="meta">${dstr(h.at)} · ${stars(h.stars)}</div><div>${esc(h.body)}</div></div>`).join("")+`<div class="panel"><div class="meta">Current · ${stars(r.stars)}</div><div>${esc(r.body)}</div></div>`}); },
  respondReview(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id), o = op(r.op);
    modal({title:`Respond as ${o.name}`, submit:"Publish response", body:`<label>Public response<textarea name="b" required></textarea></label><p class="hint" style="margin:0">Responses are public and permanent. You can't edit or remove the review itself.</p>`,
      onSubmit: f => { if (val(f,"b").length<5) return "Write a response."; r.response = {by:S.user, body:val(f,"b"), at:Date.now()}; notify(r.user,"review",`${o.name} responded to your review`,opPath(o)); }}); },
  disputeReview(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id);
    askReason("Dispute this review", reason => { r.status = "disputed"; REPORTS.push({id:++reportSeq, queue:"review_disputes", kind:"review", target:{review:r.id}, board:null, reason:`Business dispute: ${reason}`, by:S.user, at:Date.now(), status:"open"}); notify(r.user,"review","A business disputed your review. Moderators will look at it.",opPath(op(r.op))); toast("Dispute sent to moderators"); },
      {extra:`<p class="muted" style="margin:0">Moderators decide. The review stays public while they look.</p>`}); },
  reviewStatus(el){ const r = REVIEWS.find(x=>x.id===+el.dataset.id);
    askReason("Set review status", (reason,f) => { const prev = r.status; r.status = f.elements.st.value; audit(r.status==="removed"?"Review removal":"Review status",`review #${r.id} (${op(r.op).name})`,reason,prev,r.status); notify(r.user,"review",`Moderators changed your review status to “${r.status}”`,opPath(op(r.op))); },
      {extra:`<label>Status<select name="st">${REVIEW_STATUSES.map(s=>`<option ${s===r.status?"selected":""}>${s}</option>`).join("")}</select></label>`}); },

  /* ----- Complaints ----- */
  fileComplaint(el){ if (!signedIn()) return needSignIn("Sign in to file a complaint.");
    const pre = el.dataset ? el.dataset.slug : "";
    if (pre && isRep(pre)) return toast("You can't file a complaint against a business you represent.");
    modal({title:"File a complaint", submit:"Submit complaint", body:`
      <label>Casino or sportsbook<select name="op">${OPERATORS.map(o=>`<option value="${o.slug}" ${o.slug===pre?"selected":""}>${esc(o.name)} · ${o.type}</option>`).join("")}</select></label>
      <label>Title <span class="hint">One line, e.g. “Withdrawal pending for 10 days”</span><input name="title" maxlength="90" required></label>
      <div class="row"><label style="flex:2 1 200px">Issue<select name="cat">${COMPLAINT_CATS.map(c=>`<option>${c}</option>`).join("")}</select></label>
        <label style="flex:1 1 120px">Amount in USD <span class="hint">Optional, public</span><input name="amount" type="number" min="0" step="1" inputmode="numeric"></label></div>
      <label>What happened<textarea name="st" required placeholder="Dates, amounts, transaction IDs, what support told you. This becomes the first message of your case."></textarea></label>
      <label>Evidence<input type="file" name="files" multiple></label><label class="chk"><input type="checkbox" name="pub"> Make evidence public <span class="hint">(otherwise only you and our specialists see it)</span></label>
      <label class="chk"><input type="checkbox" name="support"> I contacted the operator's support first</label>
      <p class="hint" style="margin:0">Your case is public. Don't post passwords or full card numbers.</p>`,
      onSubmit: f => {
        const o = op(val(f,"op")), title = val(f,"title"), st = val(f,"st"), att = filesOf(f.elements.files);
        if (o.reps.includes(S.user)) return "You can't file a complaint against a business you represent.";
        if (title.length < 8) return "Give your complaint a short, clear title.";
        if (st.length < 40) return "Describe what happened in at least 40 characters.";
        if (!f.elements.support.checked) return "Please contact the operator's support first. Most problems get fixed there, and our specialists will ask what they said.";
        if (tooBig(att)) return `${tooBig(att).name} is over 10 MB.`;
        const pr = contentProblem(st); if (pr) return pr;
        const id = "PC-" + (++complaintSeq), now = Date.now();
        const c = CASE(id, o.slug, S.user, title, val(f,"cat"), Math.max(0, +val(f,"amount")||0), "Open", now, {
          evidence: att.map(a=>({name:a.name, public:f.elements.pub.checked})),
          messages:[CM(S.user, st, now), SYS("Complaint submitted. A specialist will pick it up within 48 hours.", now)]});
        c.statement = st; c.followers.add(S.user); COMPLAINTS.push(c); complaintThread(c);
        REPORTS.push({id:++reportSeq, queue:"complaints", kind:"complaint", target:{complaint:id}, board:null, reason:"New complaint needs a specialist", by:"system", at:now, status:"open"});
        o.reps.forEach(u=>notify(u,"complaint",`New complaint ${id} against ${o.name}: “${title}”`,"/complaints/"+id));
        nav("/complaints/"+id); toast("Complaint submitted");
      }}); },
  addEvidence(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id);
    modal({title:"Add evidence", submit:"Upload", body:`<label>Files<input type="file" name="files" multiple></label><label class="chk"><input type="checkbox" name="pub"> Public</label><p class="hint" style="margin:0">Images and PDFs, 10 MB each. Files are scanned and photo location data is removed.</p>`,
      onSubmit: f => { const att = filesOf(f.elements.files); if (!att.length) return "Choose at least one file."; if (tooBig(att)) return `${tooBig(att).name} is over 10 MB.`;
        att.forEach(a=>c.evidence.push({name:a.name, public:f.elements.pub.checked})); c.messages.push(SYS(`${S.user} added ${att.length} evidence file${att.length>1?"s":""}`, Date.now())); }}); },
  toggleEvidence(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id), e = c.evidence[+el.dataset.i]; e.public = !e.public; render(); },
  caseFollow(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id); c.followers.has(S.user) ? c.followers.delete(S.user) : c.followers.add(S.user); toast(c.followers.has(S.user)?"You'll be notified of updates":"Unfollowed"); render(); },
  caseTake(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id); const prev = c.specialist;
    c.specialist = S.user; c.messages.push(SYS(`Specialist ${S.user} ${prev?"took over":"took"} the case`, Date.now()));
    if (c.status === "Open") setCaseStatus(c, "Under Investigation", null, {quiet:true});
    REPORTS.filter(r=>r.kind==="complaint" && r.target.complaint===c.id && r.status==="open" && r.reason.startsWith("New complaint")).forEach(r=>{ r.status="resolved"; r.closedBy=S.user; r.closedAt=Date.now(); });
    audit("Complaint assigned", c.id, prev?`Taken over from ${prev}`:"Specialist assigned", prev||"unassigned", S.user);
    notify(c.user,"complaint",`Specialist ${S.user} is handling ${c.id}`,"/complaints/"+c.id); render(); },
  caseStatus(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id), v = el.dataset.v;
    askReason(`${STATUS_LABEL[v]}`, (r,f) => { const note = f.elements.note.value.trim(); if (note) c.messages.push(CM(S.user, note, Date.now())); setCaseStatus(c, v, r); },
      {submit:"Update case", extra:`<label>Message to both parties <span class="hint">Optional, public</span><textarea name="note" style="min-height:70px" placeholder="${v==="Awaiting Business"?`What you need from ${esc(op(c.op).name)}`:v==="Awaiting User"?"What you need from the player":"Why you're escalating"}"></textarea></label>`}); },
  caseOutcome(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id);
    askReason("Record outcome", (r,f) => { const v = f.elements.st.value, amt = Math.max(0, +f.elements.rec.value||0), note = f.elements.note.value.trim();
        if (note) c.messages.push(CM(S.user, note, Date.now()));
        setCaseStatus(c, v, r, {recovered: ["Resolved","Partially Resolved"].includes(v) ? amt : 0}); },
      {submit:"Close case", extra:`<label>Outcome<select name="st">${["Resolved","Partially Resolved","Unresolved","Rejected","No Response"].map(x=>`<option value="${x}">${STATUS_LABEL[x]}</option>`).join("")}</select></label>
        <label>Amount recovered for the player (USD)<input name="rec" type="number" min="0" value="${c.amount||0}"></label>
        <label>Public summary <span class="hint">Shown in the case</span><textarea name="note" style="min-height:70px"></textarea></label>
        <p class="hint" style="margin:0">Unresolved and no-response outcomes lower the operator's Safety Index. Rejected cases don't count against it.</p>`}); },
  caseSolved(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id);
    modal({title:"Mark as solved?", submit:"Yes, it's solved", body:`<label>Amount you received (USD)<input name="rec" type="number" min="0" value="${c.amount||0}"></label><label>Anything to add? <span class="hint">Optional</span><textarea name="n" style="min-height:70px"></textarea></label>`,
      onSubmit: f => { if (val(f,"n")) c.messages.push(CM(S.user, val(f,"n"), Date.now())); setCaseStatus(c, "Resolved", "Player confirmed resolution", {recovered:Math.max(0,+val(f,"rec")||0)}); }}); },
  caseWithdraw(el){ const c = COMPLAINTS.find(x=>x.id===el.dataset.id);
    modal({title:"Withdraw your complaint?", submit:"Withdraw", danger:true, body:`<p style="margin:0">The case closes and stays public. It won't count against ${esc(op(c.op).name)}.</p>`,
      onSubmit: () => setCaseStatus(c, "Closed", "Withdrawn by player") }); },
  hubSet(el){ S.ui.hub = S.ui.hub || {}; S.ui.hub[el.dataset.k] = el.checked; render(); },
  claim(el){ const o = op(el.dataset.slug);
    modal({title:`Claim ${o.name}`, submit:"Send claim", body:`<label>Work email at ${esc(o.website)}<input name="e" type="email" required></label><label>Your role<input name="r" required></label><p class="hint" style="margin:0">An admin checks your email domain and licence details. Once verified you can respond to reviews and complaints, but you can't remove them.</p>`,
      onSubmit: f => { if (!val(f,"e").includes("@")) return "Enter your work email."; o.pendingClaim = S.user;
        REPORTS.push({id:++reportSeq, queue:"claims", kind:"claim", target:{op:o.slug, user:S.user}, board:null, reason:`Claim request (${val(f,"r")}, ${val(f,"e")})`, by:S.user, at:Date.now(), status:"open"}); toast("Claim sent for verification"); }}); },
  editOperator(el){ const o = op(el.dataset.slug);
    modal({title:`Edit ${o.name}`, body:`<label>Website<input name="w" value="${esc(o.website)}"></label><label>KYC policy<input name="k" value="${esc(o.kyc)}"></label>
      <label>Withdrawal methods <span class="hint">Comma-separated</span><input name="wd" value="${esc(o.withdrawals.join(", "))}"></label><label>Supported countries <span class="hint">Comma-separated codes</span><input name="c" value="${esc(o.countries.join(", "))}"></label>
      <div class="row"><label class="chk"><input type="checkbox" name="cr" ${o.crypto?"checked":""}> Crypto</label><label class="chk"><input type="checkbox" name="fi" ${o.fiat?"checked":""}> Fiat</label></div>
      ${can("manageCategories")?`<label>Licence<input name="l" value="${esc(o.license)}"></label><label>Owner<input name="ow" value="${esc(o.owner)}"></label>`:`<p class="hint" style="margin:0">Licence and owner changes go through moderators.</p>`}`,
      onSubmit: f => { o.website = val(f,"w"); o.kyc = val(f,"k"); o.withdrawals = val(f,"wd").split(",").map(s=>s.trim()).filter(Boolean); o.countries = val(f,"c").split(",").map(s=>s.trim()).filter(Boolean); o.crypto = f.elements.cr.checked; o.fiat = f.elements.fi.checked;
        if (f.elements.l){ o.license = val(f,"l"); o.owner = val(f,"ow"); } audit("Business info edited", o.name, isRep(o.slug)?"Edited by official rep":"Admin edit", "previous", "updated"); }}); },
  blacklistOp(el){
    const pre = el.dataset.slug, choices = OPERATORS.filter(o => !o.blacklist);
    if (!choices.length) return toast("Every operator is already blacklisted.");
    modal({title:"Add to blacklist", submit:"Blacklist", danger:true, body:`
      ${pre ? `<p style="margin:0"><strong>${esc(op(pre).name)}</strong></p><input type="hidden" name="op" value="${pre}">` : `<label>Casino or sportsbook<select name="op">${choices.map(o=>`<option value="${o.slug}">${esc(o.name)}</option>`).join("")}</select></label>`}
      <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:.9rem;margin-bottom:4px">Reasons</legend>${BLACKLIST_REASONS.map((r,i)=>`<label class="row" style="gap:6px;font-weight:400;flex-direction:row"><input type="checkbox" name="r${i}"> ${esc(r)}</label>`).join("")}</fieldset>
      <label>Public summary <span class="hint">Shown on the blacklist and the operator's page</span><textarea name="note" required style="min-height:70px"></textarea></label>`,
      onSubmit: f => { const o = op(val(f,"op")); const reasons = BLACKLIST_REASONS.filter((r,i) => f.elements["r"+i].checked);
        if (!reasons.length) return "Tick at least one reason.";
        if (val(f,"note").length < 20) return "Write a short public summary of what happened (20 characters or more).";
        o.blacklist = {at:Date.now(), by:S.user, reasons, note:val(f,"note")}; syncAffiliateFlags();
        audit("Operator blacklisted", o.name, reasons.join("; "), "listed", "blacklisted");
        o.reps.forEach(u => notify(u, "complaint", `${o.name} has been blacklisted: ${reasons.join(", ")}`, opPath(o)));
        toast(`${o.name} added to the blacklist`); }}); },
  unblacklist(el){ const o = op(el.dataset.slug);
    askReason(`Remove ${o.name} from the blacklist`, r => { o.blacklist = null; audit("Operator removed from blacklist", o.name, r, "blacklisted", "listed"); toast(`${o.name} removed from the blacklist`); }, {submit:"Remove"}); },
  setWarning(el){ const o = op(el.dataset.slug);
    askReason("Warning label", (r,f) => { const v = f.elements.w.value, prev = o.warning?o.warning.status:"none"; o.warning = v==="none"?null:{status:v, label:v==="confirmed"?"Confirmed scam finding":"Open scam allegation", topic:+f.elements.t.value||null}; audit("Warning label", o.name, r, prev, v); },
      {extra:`<label>Label<select name="w"><option value="none">No label</option><option value="allegation" ${o.warning?.status==="allegation"?"selected":""}>Allegation (under review)</option><option value="confirmed" ${o.warning?.status==="confirmed"?"selected":""}>Confirmed finding</option></select></label><label>Related topic ID<input name="t" type="number" value="${o.warning?.topic||""}"></label>`}); },

  newListing(el){
    if (!signedIn()) return needSignIn("Sign in to post a listing.");
    if (!can("listing")) return toast(`${roleLabel(S.role)} accounts can't post listings yet.`);
    const pre = el && el.dataset ? el.dataset.cat : "";
    modal({title:"Post a listing", submit:"Post listing", body:`<label>Category<select name="cat">${MARKET_CATS.map(c=>`<option ${c===pre?"selected":""}>${c}</option>`).join("")}</select><span class="hint">Your listing becomes a topic on that board.</span></label>
      <label>Topic title<input name="t" required placeholder="e.g. [WTS] 2010 Ghana home kit, size M"></label><label>Price<input name="p" required placeholder="e.g. $40 or GH₵ 200"></label>
      <label>Description<textarea name="d" required placeholder="Condition, delivery, how you'll accept payment"></textarea></label>
      <fieldset style="border:1px solid var(--line);border-radius:8px;padding:10px 12px"><legend class="lbl">🔒 Escrow</legend>
        <label class="chk"><input type="checkbox" name="esc" ${Object.keys(me().wallets||{}).length && ESCROW_SETTINGS.boards.has(MARKET_BOARD[pre]) ? "checked" : ""}> Accept escrow payments in USDT or USDC</label>
        <div class="row"><label style="flex:1 1 140px">Price in USD for escrow<input name="usd" type="number" min="${ESCROW_SETTINGS.minUsd}" max="${ESCROW_SETTINGS.maxUsd}" step="0.01" placeholder="Taken from the price if it's in $"></label>
        ${Object.keys(me().wallets||{}).length ? "" : `<label style="flex:2 1 220px">Payout wallet <span class="hint">Tron (T…) or Base/Polygon (0x…)</span><input name="wallet" class="mono" placeholder="T… or 0x…" spellcheck="false" autocomplete="off"></label>`}</div>
        <span class="hint">The other person pays into an escrow contract and you're paid when they confirm delivery. Not available for Tickets, Crypto Trades or Jobs.</span></fieldset><p class="hint" style="margin:0">${mp("queue.listings") ? "You can approve listings, so this one goes live straight away." : "A moderator checks every listing before it goes live, usually within a few hours."} Tickets at face value only. Without escrow, people pay you directly.</p>`,
      onSubmit: f => { if (val(f,"t").length<6) return "Give the listing a clearer title."; if (!val(f,"p")) return "Add a price, or write “Offers”."; const pr = contentProblem(val(f,"d")); if (pr) return pr;
        if (!mp("queue.listings") && LISTINGS.filter(x=>x.seller===S.user && x.approval==="pending").length >= 5) return "You have 5 listings waiting for approval. Wait for those to be checked before posting more.";
        let escOn = f.elements.esc.checked, usdv = +val(f,"usd") || 0;
        if (escOn && !usdv){ const m = val(f,"p").replace(/,/g,"").match(/^\s*(?:\$|usd\s*|usdt\s*|usdc\s*)?(\d+(?:\.\d+)?)\s*(?:\$|usd|usdt|usdc)?\s*$/i); if (m && /\$|usd/i.test(val(f,"p"))) usdv = +m[1]; }
        if (escOn){
          if (!ESCROW_SETTINGS.boards.has(MARKET_BOARD[val(f,"cat")])) return `Escrow isn't available for ${val(f,"cat")}. Untick “Accept escrow” to post it without.`;
          if (!(usdv >= ESCROW_SETTINGS.minUsd && usdv <= ESCROW_SETTINGS.maxUsd)) return `For escrow, enter a USD price between ${ESCROW_SETTINGS.minUsd} and ${fmt(ESCROW_SETTINGS.maxUsd)}.`;
          if (f.elements.wallet){ const w = val(f,"wallet"), kind = w.startsWith("T") ? "tron" : "evm";
            if (!validWallet(kind, w)) return "Add a valid payout wallet: a Tron address (T…, 34 characters) or a Base/Polygon address (0x…, 42 characters).";
            me().wallets = Object.assign(me().wallets||{}, {[kind]: w}); }
        }
        const l = {id:++listingSeq, cat:val(f,"cat"), title:val(f,"t"), seller:S.user, price:val(f,"p"), usd: usdv || null, escrow: escOn, status:"Available", featured:false, at:Date.now(), desc:val(f,"d"), feedback:[]};
        const self = mp("queue.listings");
        l.approval = self ? "approved" : "pending";
        LISTINGS.unshift(l); const t = threadFor(l, "listing"); me().posts++; me().topics++;
        if (self) audit("Listing approved", `listing #${l.id} “${l.title}”`, "Posted by staff with approval permission", "new", "approved");
        else queueListing(l, "New listing waiting for approval");
        nav("/topic/"+t.id); toast(self ? "Listing posted" : "Listing submitted. A moderator will approve it before it goes live."); }}); },
  listingStatus(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id); l.status = el.dataset.v; toast(`Marked ${l.status}`); render(); },
  featureReq(el){ LISTINGS.find(x=>x.id===+el.dataset.id).featureReq = true; toast("Request sent. Featured placements are paid and labelled."); },
  leaveFeedback(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id);
    modal({title:"Leave feedback", submit:"Submit", body:`<label>Rating<select name="s">${[5,4,3,2,1].map(n=>`<option value="${n}">${stars(n)} ${n}</option>`).join("")}</select></label><label>Comment<textarea name="c" required style="min-height:80px"></textarea></label>`,
      onSubmit: f => { l.feedback.push({from:S.user, stars:+val(f,"s"), text:val(f,"c"), at:Date.now()}); (SELLER_FEEDBACK[l.seller] = SELLER_FEEDBACK[l.seller]||[]).push(+val(f,"s")); USERS[l.seller].rep.market += +val(f,"s")>=4?2:-2; notify(l.seller,"market",`${S.user} left feedback on “${l.title}”`,"/topic/"+l.thread); }}); },
  dispute(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id);
    askReason("Open a marketplace dispute", r => { REPORTS.push({id:++reportSeq, queue:"market", kind:"listing", target:{listing:l.id}, board:null, reason:`Dispute: ${r}`, by:S.user, at:Date.now(), status:"open"}); notify(l.seller,"market",`${S.user} opened a dispute on “${l.title}”`,"/topic/"+l.thread); toast("Dispute opened. A moderator will contact both of you."); },
      {submit:"Open dispute", extra:`<p class="muted" style="margin:0">Pitchside can't refund payments, but moderators can mediate, warn members and adjust marketplace reputation.</p>`}); },
  removeListing(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id); askReason(l.removed?"Restore listing":"Remove listing", r => { audit(l.removed?"Restore listing":"Remove listing",`listing #${l.id}`,r,l.removed?"removed":"visible",l.removed?"visible":"removed"); l.removed = !l.removed; }); },

  dm(el){ const u = el.dataset.user;
    if (!signedIn()) return needSignIn("Sign in to send messages.");
    if (u === S.user) return toast("That's you.");
    const chk = dmCheck(u); if (!chk.ok) return toast(chk.why);
    const ex = findDirect(u);
    if (ex && !el.dataset.ref) return go("/messages/"+ex.id);
    openNewMessage(u, el.dataset.ref ? `Hi, is “${el.dataset.ref}” still available?` : ""); },
  newMessage(){ openNewMessage(); },
  convAdd(el){ const c = CONVS.find(x=>x.id===+el.dataset.id);
    modal({title:"Add people", submit:"Add", body:`<label>Usernames<input name="u" list="aclist-users" placeholder="name, name"></label>`, onSubmit: f => {
      const ns = val(f,"u").split(/[,\s]+/).map(s=>s.replace(/^@/,"")).filter(Boolean); if (!ns.length) return "Add at least one username.";
      for (const n of ns){ if (!USERS[n]) return `No member called ${n}.`; const k = dmCheck(n); if (!k.ok && n!==S.user) return k.why; }
      ns.filter(n=>!c.members.includes(n)).forEach(n=>{ c.members.push(n); notify(n,"message",`${S.user} added you to “${convTitle(c)}”`,"/messages/"+c.id); });
      if (!c.title) c.title = "Group chat"; }}); },
  convRename(el){ const c = CONVS.find(x=>x.id===+el.dataset.id); modal({title:"Rename conversation", body:`<label>Name<input name="t" value="${esc(c.title||"")}"></label>`, onSubmit: f => { c.title = val(f,"t") || c.title; }}); },
  convLeave(el){ const c = CONVS.find(x=>x.id===+el.dataset.id); modal({title:"Leave conversation?", submit:"Leave", danger:true, body:`<p style="margin:0">You'll stop getting messages from “${esc(convTitle(c))}”.</p>`, onSubmit: () => { c.members = c.members.filter(m=>m!==S.user); nav("/messages"); }}); },
  deleteMsg(el){ const c = CONVS.find(x=>x.id===+el.dataset.conv); const i = c.msgs.findIndex(m=>m.id===+el.dataset.msg); if (i>-1){ c.msgs.splice(i,1); Object.keys(c.read).forEach(k=>{ if (c.read[k]>i) c.read[k]--; }); } render(); },
  block(el){ const u = el.dataset.user; if (u === S.user) return toast("You can't block yourself.");
    const s = BLOCKS[S.user] = BLOCKS[S.user]||new Set(); s.has(u) ? s.delete(u) : s.add(u); toast(s.has(u)?`Blocked ${u}. They can't message you.`:`Unblocked ${u}`); render(); },
  userAction(el){ const u = USERS[el.dataset.user];
    const opts = [...(mp("user.warn")?[["warn","Warn"]]:[]),...(mp("user.suspend")?[["suspend",`Suspend ${suspendDays()} days`]]:[]),...(mp("user.ban")?[["ban","Ban"]]:[]),...(u.status!=="active"&&mp("user.restore")?[["restore","Restore account"]]:[]),...(can("managePermissions")&&!u.verified?[["verify","Mark email verified"]]:[])];
    askReason(`Moderate ${u.name}`, (r,f) => { const a = f.elements.a.value, prev = u.status;
      if (a==="warn"){ u.warnings++; audit("Warning",u.name,r,`${u.warnings-1} warnings`,`${u.warnings} warnings`); }
      if (a==="suspend"){ u.status = "suspended"; audit("Suspended user",u.name,`${r} (${suspendDays()} days)`,prev,"suspended"); }
      if (a==="ban"){ u.status = "banned"; audit("Banned user",u.name,r,prev,"banned"); }
      if (a==="restore"){ u.status = "active"; audit("Restored user",u.name,r,prev,"active"); }
      if (a==="verify"){ u.verified = true; audit("Email verified",u.name,r,"unverified","verified"); }
      notify(u.name,"moderator",`Moderator action on your account (${a}): ${r}. You can appeal from your profile.`,"/members/"+u.name); },
      {extra:`<label>Action<select name="a">${opts.map(([v,t])=>`<option value="${v}">${t}</option>`).join("")}</select></label>`}); },
  appeal(){ modal({title:"Appeal", submit:"Send appeal", body:`<label>Why should this be lifted?<textarea name="t" required></textarea></label>`, onSubmit: f => { if (val(f,"t").length<10) return "Explain in a sentence or two.";
    REPORTS.push({id:++reportSeq, queue:"appeals", kind:"appeal", target:{user:S.user, text:val(f,"t")}, board:null, reason:`Appeal of ${me().status}`, by:S.user, at:Date.now(), status:"open"}); toast("Appeal sent to senior moderators"); }}); },
  sType(el){ S.ui.sf = Object.assign(S.ui.sf||{}, {type:el.dataset.v}); render(); },
  readAll(){ NOTIFS.filter(n=>n.to===S.user).forEach(n=>n.read=true); render(); },
  openNotif(el){ const n = NOTIFS.find(x=>x.id===+el.dataset.id); n.read = true; go(n.go); },

  resolve(el){ const r = REPORTS.find(x=>x.id===+el.dataset.id), opn = el.dataset.op, tg = reportTarget(r);
    const labels = {hide:"Hide content", warn:"Warn author", suspend:"Suspend author for 7 days", ban:"Ban author", resolveOnly:"Mark resolved", dismiss:"Dismiss report", approveClaim:"Approve business claim", rejectClaim:"Reject business claim", upholdAppeal:"Lift restriction", denyAppeal:"Deny appeal"};
    askReason(labels[opn], reason => {
      const author = tg.author && USERS[tg.author], t = r.target;
      if (opn==="hide"){
        if (r.kind==="post"){ const tp = topic(t.topic); const p = t.post ? tp.posts.find(x=>x.id===t.post) : tp.posts[tp.posts.length-1]; if (p) p.hidden = true; }
        if (r.kind==="topic") topic(t.topic).deleted = true;
        if (r.kind==="review"){ const rv = REVIEWS.find(x=>x.id===t.review); rv.status = "removed"; }
        if (r.kind==="listing") LISTINGS.find(x=>x.id===t.listing).removed = true;
        if (r.kind==="message"){ const c = CONVS.find(x=>x.id===t.conv); const m = c && c.msgs.find(x=>x.id===t.msg); if (m) m.body = "[Removed by a moderator]"; }
        audit(r.kind==="review"?"Review removal":"Hide content", `${r.kind} (report #${r.id})`, reason, "visible", "hidden");
      }
      if (author && opn==="warn"){ author.warnings++; audit("Warning", author.name, reason, `${author.warnings-1}`, `${author.warnings}`); notify(author.name,"moderator",`You received a warning: ${reason}`,"/members/"+author.name); }
      if (author && opn==="suspend"){ const p = author.status, d = suspendDays(); author.status = "suspended"; audit("Suspended user", author.name, `${reason} (${d} days)`, p, "suspended"); notify(author.name,"moderator",`Your account is suspended for ${d} days: ${reason}`,"/members/"+author.name); }
      if (author && opn==="ban"){ const p = author.status; author.status = "banned"; audit("Banned user", author.name, reason, p, "banned"); }
      if (opn==="approveClaim"){ const o = op(t.op); o.claimed = true; o.verified = true; o.pendingClaim = null; if (!o.reps.includes(t.user)) o.reps.push(t.user); if (!USERS[t.user].business) USERS[t.user].business = o.slug; audit("Business verification", o.name, reason, "unclaimed", "verified"); notify(t.user,"review",`Your claim on ${o.name} was approved`,opPath(o)); }
      if (opn==="rejectClaim"){ const o = op(t.op); o.pendingClaim = null; audit("Business claim rejected", o.name, reason, "pending", "rejected"); notify(t.user,"review",`Your claim on ${o.name} was rejected: ${reason}`,opPath(o)); }
      if (opn==="upholdAppeal"){ const p = USERS[t.user].status; USERS[t.user].status = "active"; audit("Appeal upheld", t.user, reason, p, "active"); notify(t.user,"moderator","Your appeal was accepted. Your account is active again.","/members/"+t.user); }
      if (opn==="denyAppeal"){ audit("Appeal denied", t.user, reason, USERS[t.user].status, USERS[t.user].status); notify(t.user,"moderator",`Your appeal was denied: ${reason}`,"/members/"+t.user); }
      if (["resolveOnly","dismiss"].includes(opn)) audit(opn==="dismiss"?"Dismiss report":"Resolve report", `report #${r.id}`, reason, "open", opn==="dismiss"?"dismissed":"resolved");
      r.status = opn==="dismiss"||opn==="denyAppeal"||opn==="rejectClaim" ? "dismissed" : "resolved"; r.closedBy = S.user; r.closedAt = Date.now();
      if (r.by !== "system" && USERS[r.by] && r.kind!=="claim" && r.kind!=="appeal") notify(r.by,"moderator",`Your report was reviewed: ${r.status}`,"/notifications");
    }, {danger: ["ban","suspend","hide"].includes(opn)}); },

  addCat(){ modal({title:"Add category", body:`<label>Name<input name="n" required></label><label class="chk"><input type="checkbox" name="g"> 18+ (age gate)</label>`,
    onSubmit: f => { const n = val(f,"n"); if (!n) return "Name it."; const id = slugify(n); if (CATEGORIES.some(c=>c.id===id)) return "That category exists.";
      CATEGORIES.push({id, name:n, order:CATEGORIES.length+1, gated:f.elements.g.checked}); audit("Category/board change",`category ${n}`,"Created","none","created"); }}); },
  catMove(el){ const cs = CATEGORIES.slice().sort((a,b)=>a.order-b.order), i = cs.findIndex(c=>c.id===el.dataset.id), j = i + +el.dataset.d;
    [cs[i].order, cs[j].order] = [cs[j].order, cs[i].order]; audit("Category/board change",`category ${cs[i].name}`,"Reorder",i+1,j+1); render(); },
  catEdit(el){ const c = CATEGORIES.find(x=>x.id===el.dataset.id); modal({title:"Edit category", body:`<label>Name<input name="n" value="${esc(c.name)}"></label><label class="chk"><input type="checkbox" name="g" ${c.gated?"checked":""}> 18+ (age gate)</label>`,
    onSubmit: f => { const prev = c.name; c.name = val(f,"n")||c.name; c.gated = f.elements.g.checked; audit("Category/board change",`category ${c.name}`,"Edited",prev,c.name); }}); },
  catDel(el){ const c = CATEGORIES.find(x=>x.id===el.dataset.id); if (BOARDS.some(b=>b.cat===c.id)) return toast("Move or delete this category's boards first.");
    modal({title:`Delete ${c.name}?`, submit:"Delete", danger:true, body:"<p style='margin:0'>This can't be undone.</p>", onSubmit: () => { CATEGORIES = CATEGORIES.filter(x=>x!==c); audit("Category/board change",`category ${c.name}`,"Deleted","exists","deleted"); }}); },
  boardEdit(el){ const b = el.dataset.slug ? board(el.dataset.slug) : null;
    const tops = BOARDS.filter(x=>!x.parent && x!==b);
    modal({title:b?`Edit ${b.name}`:"Add board", body:`<label>Name<input name="n" value="${esc(b?b.name:"")}" required></label><label>Description<input name="d" value="${esc(b?b.desc:"")}"></label>
      <div class="row"><label style="flex:1">Category<select name="c">${CATEGORIES.map(c=>`<option value="${c.id}" ${b&&b.cat===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label style="flex:1">Parent board<select name="p"><option value="">None (top level)</option>${tops.map(x=>`<option value="${x.slug}" ${b&&b.parent===x.slug?"selected":""}>${esc(x.name)}</option>`).join("")}</select></label></div>
      <label>Moderators <span class="hint">Comma-separated usernames</span><input name="m" value="${esc(b?b.mods.join(", "):"")}" list="aclist-users"></label>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">Who can post</legend><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px">${roleChecks(b?b.postRoles:ALL_POSTERS).replace(/name="r_/g,'name="p_')}</div></fieldset>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">Who can read</legend><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px">${roleChecks(b?b.readRoles:ROLES.map(r=>r.id)).replace(/name="r_/g,'name="v_')}</div></fieldset>`,
      onSubmit: f => { const n = val(f,"n"); if (!n) return "Name the board.";
        const mods = val(f,"m").split(",").map(s=>s.trim()).filter(Boolean); const bad = mods.find(m=>!USERS[m]); if (bad) return `No member called ${bad}.`;
        const notMod = mods.find(m=>!["moderator","senior_moderator","admin","super_admin"].includes(USERS[m].role)); if (notMod) return `${notMod} isn't a moderator. Change their role under Users first.`;
        const pr = val(f,"p"); if (pr && board(pr).cat !== val(f,"c")) return "A sub-board must be in the same category as its parent.";
        const data = {name:n, desc:val(f,"d"), cat:val(f,"c"), parent:pr||null, mods, postRoles:pickRoles(f,"p_"), readRoles:pickRoles(f,"v_")};
        if (!data.readRoles.length) return "At least one role must be able to read the board.";
        if (b){ const prev = `${b.name}; post: ${b.postRoles.length} roles`; Object.assign(b, data); audit("Category/board change",`board ${b.name}`,"Edited (incl. permissions)",prev,`${b.name}; post: ${b.postRoles.length} roles`); }
        else { const slug = slugify(n); if (board(slug)) return "A board with that name exists."; BOARDS.push(B(slug, n, data.desc, data.cat, Object.assign(data, {order:99}))); audit("Category/board change",`board ${n}`,"Created","none","created"); } }}); },
  boardMove(el){ const b = board(el.dataset.slug), sib = BOARDS.filter(x=>x.cat===b.cat && x.parent===b.parent).sort((a,c)=>a.order-c.order);
    sib.forEach((x,i)=>x.order=i); const i = sib.indexOf(b), j = i + +el.dataset.d; if (j<0||j>=sib.length) return; [sib[i].order, sib[j].order] = [sib[j].order, sib[i].order]; audit("Category/board change",`board ${b.name}`,"Reorder",i+1,j+1); render(); },
  boardDel(el){ const b = board(el.dataset.slug); if (TOPICS.some(t=>t.board===b.slug && !t.deleted) || BOARDS.some(x=>x.parent===b.slug)) return toast("Move this board's topics and sub-boards first.");
    modal({title:`Delete ${b.name}?`, submit:"Delete", danger:true, body:"<p style='margin:0'>The board is empty. This can't be undone.</p>", onSubmit: () => { BOARDS = BOARDS.filter(x=>x!==b); audit("Category/board change",`board ${b.name}`,"Deleted","exists","deleted"); }}); },
  addTag(){ modal({title:"Add tag", body:`<label>Name<input name="n" required></label><label>Description<input name="d"></label><label class="chk"><input type="checkbox" name="i"> Indexed (gets an SEO landing page)</label>`,
    onSubmit: f => { const n = val(f,"n"); if (!n) return "Name the tag."; const slug = slugify(n); if (TAGS.some(t=>t.slug===slug)) return "That tag exists."; TAGS.push({slug, name:n, desc:val(f,"d"), index:f.elements.i.checked}); }}); },
  navMove(el){ const i = +el.dataset.i, j = i + +el.dataset.d; [NAV[i], NAV[j]] = [NAV[j], NAV[i]]; render(); },
  twoFA(){ const u = me(); if (u.twoFA){ u.twoFA = false; toast("Two-factor turned off"); return render(); }
    modal({title:"Turn on two-factor", submit:"Verify", body:`<p style="margin:0">Scan the QR code in your authenticator app, then enter the 6-digit code.</p><div class="mono" style="padding:16px;background:var(--sunk);text-align:center;border-radius:6px">JBSW Y3DP EHPK 3PXP</div><label>Code<input name="c" inputmode="numeric" maxlength="6" placeholder="123456"></label>`,
      onSubmit: f => { if (!/^\d{6}$/.test(val(f,"c"))) return "Enter the 6-digit code from your app."; u.twoFA = true; toast("Two-factor is on"); }}); },
  logoutAll(){ toast("Logged out of all other devices"); },
  exportData(){ toast("We'll email you a download link within 24 hours."); },
  contactStaff(el){
    if (!signedIn()) return needSignIn("Sign in to contact staff.");
    const to = el.dataset.to;
    if (to === "admins") return staffPicker();
    if (to === "board"){ const b = board(el.dataset.board); const mods = b.mods.length ? b.mods : (b.parent ? board(b.parent).mods : []);
      if (!mods.length) return staffPicker();
      return openStaffConv(mods, `${b.name} moderators`, null); }
    staffPicker(); },

  /* ----- Admin → Moderators ----- */
  appointMod(){
    const cands = Object.values(USERS).filter(u => !STAFF_ROLES.includes(u.role) && u.role !== "business" && u.status === "active");
    modal({title:"Appoint a moderator", submit:"Appoint", body:`
      <label>Member<select name="u">${cands.map(u=>`<option value="${u.name}">${esc(u.name)} · ${esc(rankFor(u.posts))} · ${fmt(u.posts)} posts</option>`).join("")}</select></label>
      <label>Template<select name="t">${MOD_TEMPLATES.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select><span class="hint">You can customise individual permissions afterwards.</span></label>
      <fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">Boards</legend><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px">${BOARDS.map(b=>`<label class="chk" style="font-size:.88rem"><input type="checkbox" name="b_${b.slug}"> ${b.parent?"↳ ":""}${esc(b.name)}</label>`).join("")}</div></fieldset>
      <label>Reason<input name="r" placeholder="e.g. Active, fair, volunteered for the GPL board"></label>`,
      onSubmit: f => { const u = USERS[val(f,"u")]; if (!u) return "Pick a member."; const t = MOD_TEMPLATES.find(x=>x.id===val(f,"t"));
        const bs = BOARDS.filter(b => f.elements["b_"+b.slug].checked); if (!t.allBoards && !bs.length) return "Pick at least one board, or use a template that covers all boards.";
        const prev = u.role; u.role = t.allBoards ? "senior_moderator" : "moderator";
        MOD_PROFILES[u.name] = {template:t.id, allow:new Set(), deny:new Set(), suspendMaxDays: t.allBoards ? 30 : 7};
        bs.forEach(b => { if (!b.mods.includes(u.name)) b.mods.push(u.name); });
        if (!u.badges.includes("Moderator")) u.badges.push("Moderator");
        audit("Permission change", u.name, val(f,"r")||"Appointed moderator", roleLabel(prev), `${roleLabel(u.role)} · ${t.name} · ${bs.map(b=>b.name).join(", ")||"all boards"}`);
        notify(u.name,"moderator",`You've been appointed ${t.name}. Your tools are in the moderation queue.`,"/mod"); toast(`${u.name} is now a moderator`); }}); },
  modBoards(el){ const name = el.dataset.user, t = modTemplate(name);
    if (t.allBoards) return modal({title:`${name}'s boards`, submit:null, cancel:"Close", body:`<p style="margin:0">${esc(name)} uses the “${esc(t.name)}” template, which covers every board. Switch to a board-scoped template to limit them.</p>`});
    modal({title:`Boards for ${name}`, body:`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px">${BOARDS.map(b=>`<label class="chk" style="font-size:.9rem"><input type="checkbox" name="b_${b.slug}" ${b.mods.includes(name)?"checked":""}> ${b.parent?"↳ ":""}${esc(b.name)}</label>`).join("")}</div><p class="hint" style="margin:0">Covering a parent board includes its sub-boards.</p>`,
      onSubmit: f => { const prev = modBoardsOf(name).map(b=>b.name).join(", ")||"none";
        BOARDS.forEach(b => { const on = f.elements["b_"+b.slug].checked, has = b.mods.includes(name); if (on && !has) b.mods.push(name); if (!on && has) b.mods = b.mods.filter(m=>m!==name); });
        audit("Permission change", name, "Moderator boards changed", prev, modBoardsOf(name).map(b=>b.name).join(", ")||"none"); }}); },
  modCustom(el){ const name = el.dataset.user, p = modProfile(name), t = modTemplate(name), eff = modPerms(name);
    modal({title:`Permissions for ${name}`, body:`<p class="muted" style="margin:0">Starts from “${esc(t.name)}”. Ticks that differ from the template are saved as personal changes for ${esc(name)} only.</p>
      ${MOD_PERMS.map(g=>`<fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">${esc(g.group)}</legend><div class="stack" style="gap:4px">${g.keys.map(([k,l])=>`<label class="chk" style="font-size:.9rem"><input type="checkbox" name="k_${k}" ${eff.has(k)?"checked":""}> ${esc(l)}${t.perms.has(k)?"":' <span class="pill" style="margin-left:4px">not in template</span>'}</label>`).join("")}</div></fieldset>`).join("")}`,
      onSubmit: f => { const prev = `+${p.allow.size} / −${p.deny.size}`;
        p.allow = new Set(); p.deny = new Set();
        ALL_MOD_KEYS.forEach(k => { const on = f.elements["k_"+k].checked; if (on && !t.perms.has(k)) p.allow.add(k); if (!on && t.perms.has(k)) p.deny.add(k); });
        audit("Permission change", name, "Custom moderator permissions", prev, `+${p.allow.size} / −${p.deny.size}`); toast(`Saved. ${name} now has ${modPerms(name).size} permissions.`); }}); },
  removeMod(el){ const u = USERS[el.dataset.user];
    askReason(`Remove ${u.name} as moderator`, r => { const prev = roleLabel(u.role); u.role = "trusted"; BOARDS.forEach(b => b.mods = b.mods.filter(m=>m!==u.name)); delete MOD_PROFILES[u.name]; u.badges = u.badges.filter(b=>!/moderator/i.test(b));
      audit("Permission change", u.name, r, prev, "Trusted Member"); notify(u.name,"moderator","Your moderator role has ended. Thank you for your help.","/members/"+u.name); }, {danger:true, submit:"Remove"}); },
  editTpl(el){ const t = el.dataset.id ? MOD_TEMPLATES.find(x=>x.id===el.dataset.id) : null;
    modal({title: t ? `Edit “${t.name}”` : "New template", body:`<label>Name<input name="n" value="${esc(t?t.name:"")}" required></label><label>Description<input name="d" value="${esc(t?t.desc:"")}"></label>
      <label class="chk"><input type="checkbox" name="all" ${t&&t.allBoards?"checked":""}> Covers all boards (otherwise only boards assigned to each moderator)</label>
      ${MOD_PERMS.map(g=>`<fieldset style="border:1px solid var(--line);border-radius:6px;padding:10px"><legend class="lbl">${esc(g.group)}</legend><div class="stack" style="gap:4px">${g.keys.map(([k,l])=>`<label class="chk" style="font-size:.9rem"><input type="checkbox" name="k_${k}" ${t&&t.perms.has(k)?"checked":""}> ${esc(l)}</label>`).join("")}</div></fieldset>`).join("")}`,
      onSubmit: f => { const n = val(f,"n"); if (!n) return "Name the template."; const perms = new Set(ALL_MOD_KEYS.filter(k=>f.elements["k_"+k].checked)); if (!perms.size) return "Tick at least one permission.";
        if (t){ const prev = `${t.perms.size} perms`; Object.assign(t, {name:n, desc:val(f,"d"), allBoards:f.elements.all.checked, perms}); audit("Permission change", `template ${n}`, "Template edited", prev, `${perms.size} perms`); }
        else { const id = slugify(n) || "tpl-"+MOD_TEMPLATES.length; if (MOD_TEMPLATES.some(x=>x.id===id)) return "A template with that name exists."; MOD_TEMPLATES.push({id, name:n, desc:val(f,"d"), allBoards:f.elements.all.checked, perms}); audit("Permission change", `template ${n}`, "Template created", "none", `${perms.size} perms`); } }}); },
  copyTpl(el){ const t = MOD_TEMPLATES.find(x=>x.id===el.dataset.id); let i = 2; while (MOD_TEMPLATES.some(x=>x.id===`${t.id}-${i}`)) i++;
    MOD_TEMPLATES.push({id:`${t.id}-${i}`, name:`${t.name} (copy)`, desc:t.desc, allBoards:t.allBoards, perms:new Set(t.perms)}); toast("Template copied"); render(); },
  delTpl(el){ const t = MOD_TEMPLATES.find(x=>x.id===el.dataset.id);
    modal({title:`Delete “${t.name}”?`, submit:"Delete", danger:true, body:"<p style='margin:0'>No moderators use this template.</p>", onSubmit: () => { MOD_TEMPLATES = MOD_TEMPLATES.filter(x=>x!==t); audit("Permission change", `template ${t.name}`, "Template deleted", "exists", "deleted"); }}); },
  /* ----- Marketplace approval ----- */
  approveListing(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id); if (!l) return;
    const prev = l.approval; l.approval = "approved"; l.rejectReason = null; l.approvedBy = S.user; l.approvedAt = Date.now();
    closeListingQueue(l, "resolved");
    audit("Listing approved", `listing #${l.id} “${l.title}”`, "Meets marketplace rules", prev, "approved");
    notify(l.seller, "market", `Your listing “${l.title}” was approved and is now live`, "/topic/"+l.thread);
    toast("Listing approved and published"); render(); },
  rejectListing(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id); if (!l) return;
    modal({title:`Reject “${l.title}”?`, submit:"Reject listing", danger:true, body:`
      <label>Reason <span class="hint">They'll see this</span><select name="why">${["Tickets above face value","Prohibited item","Counterfeit or unverified signature","Missing price or details","Duplicate listing","Wrong category","Off-platform payment or contact details","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label>
      <label>Note to ${esc(l.seller)} <span class="hint">Optional. Tell them what to change.</span><textarea name="note" style="min-height:70px"></textarea></label>`,
      onSubmit: f => { const why = val(f,"why"), note = val(f,"note"), reason = note ? `${why}: ${note}` : why;
        const prev = l.approval; l.approval = "rejected"; l.rejectReason = reason;
        closeListingQueue(l, "dismissed");
        audit("Listing rejected", `listing #${l.id} “${l.title}”`, reason, prev, "rejected");
        notify(l.seller, "market", `Your listing “${l.title}” wasn't approved: ${reason}. Edit it to resubmit.`, "/topic/"+l.thread);
        toast("Listing rejected. They've been told why."); }}); },
  openApprovals(){ S.ui.mq2 = "listings"; go("/mod"); },
  /* ----- Banner ads ----- */
  adClick(el){ const b = BANNERS.find(x=>x.id===+el.dataset.id); if (!b) return; b.clicks++;
    const al = b.partner && affLinkFor(b.partner);
    if (al){ logAffClick(al, "banner"); return leaveTo(al.url.replace(/\{placement\}/g, "banner"), "Affiliate link"); }
    if (b.dest.startsWith("/")) return go(b.dest);
    toast(`Sponsored link: would open ${b.dest.replace(/^https?:\/\//,"").split("/")[0]} in a new tab`); },
  bannerEdit(el){ const b = el.dataset.id ? BANNERS.find(x=>x.id===+el.dataset.id) : null; S.ui.bannerImg = b ? b.img : null;
    const d = t => new Date(t).toISOString().slice(0,10);
    modal({title: b ? `Edit banner: ${b.advertiser}` : "New homepage banner", submit: b ? "Save banner" : "Create banner", body:`
      <div class="row"><label style="flex:1 1 200px">Advertiser<input name="adv" value="${esc(b?b.advertiser:"")}" required></label>
        <label style="flex:1 1 200px">Affiliate / operator link<select name="partner"><option value="">None</option>${OPERATORS.map(o=>`<option value="${o.slug}" ${b&&b.partner===o.slug?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label></div>
      <label>Headline <span class="hint">Up to 60 characters</span><input name="h" maxlength="60" value="${esc(b?b.headline:"")}" required></label>
      <label>Text <span class="hint">Up to 160 characters</span><textarea name="t" maxlength="160" style="min-height:70px">${esc(b?b.text:"")}</textarea></label>
      <div class="row"><label style="flex:1 1 160px">Button label<input name="cta" value="${esc(b?b.cta:"Learn more")}"></label>
        <label style="flex:2 1 240px">Destination <span class="hint">https://… or a Pitchside path like /forum/tickets</span><input name="dest" value="${esc(b?b.dest:"")}" required></label></div>
      <div class="row"><label style="flex:1">Background<input type="color" name="bg" value="${b?b.bg:"#EAF4FC"}" style="height:40px"></label>
        <label style="flex:1">Text<select name="fg"><option value="#0E3A5B" ${!b||b.fg!=="#FFFFFF"?"selected":""}>Dark text</option><option value="#FFFFFF" ${b&&b.fg==="#FFFFFF"?"selected":""}>Light text</option></select></label>
        <label style="flex:1">Button colour<input type="color" name="accent" value="${b?b.accent:"#A9D6F5"}" style="height:40px"></label></div>
      <label>Image <span class="hint">Optional. Square, at least 340 × 340 px, PNG or JPG under 2 MB. Shown at 170 × 170 beside the text; hidden on phones.</span><input type="file" name="img" accept="image/*" data-change="bannerImg">${b&&b.img?`<span class="hint">Current image kept unless you choose a new one.</span>`:""}</label>
      <div class="row"><label style="flex:1">Starts<input type="date" name="start" value="${d(b?b.start:Date.now())}"></label><label style="flex:1">Ends<input type="date" name="end" value="${d(b?b.end:Date.now()+30*DAY)}"></label></div>
      <label class="chk"><input type="checkbox" name="gam" ${b&&b.gambling?"checked":""}> Gambling advertiser (adds 18+ notice, hidden from unconfirmed guests)</label>`,
      onSubmit: f => {
        const h = val(f,"h"), dest = val(f,"dest"), adv = val(f,"adv");
        if (!adv || !h) return "Add the advertiser and a headline.";
        if (!/^https?:\/\/\S+\.\S+/.test(dest) && !dest.startsWith("/")) return "Destination must be a full https:// link or a Pitchside path starting with /.";
        const start = new Date(val(f,"start")).getTime(), end = new Date(val(f,"end")).getTime() + DAY - 1;
        if (!(end > start)) return "The end date must be after the start date.";
        const partner = val(f,"partner"), po = partner && op(partner);
        if (po && po.warning && po.warning.status === "confirmed") return `${po.name} has a confirmed scam finding and can't advertise.`;
        const gambling = f.elements.gam.checked || !!po;
        const data = {advertiser:adv, headline:h, text:val(f,"t"), cta:val(f,"cta")||"Learn more", dest, bg:f.elements.bg.value, fg:f.elements.fg.value, accent:f.elements.accent.value, gambling, partner:partner||null, start, end, img:S.ui.bannerImg||null};
        if (b){ Object.assign(b, data); audit("Advertising change", `banner: ${adv}`, "Banner edited", "previous", "updated"); toast("Banner saved"); }
        else { BANNERS.push(Object.assign({id:++bannerSeq, paused:false, house:false, imps:0, clicks:0}, data)); audit("Advertising change", `banner: ${adv}`, "Banner created", "none", `${dday(start)} – ${dday(end)}`); toast("Banner created"); }
      }}); },
  bannerPause(el){ const b = BANNERS.find(x=>x.id===+el.dataset.id); b.paused = !b.paused; audit("Advertising change", `banner: ${b.advertiser}`, b.paused?"Paused":"Resumed", b.paused?"live":"paused", b.paused?"paused":"live"); toast(b.paused?"Banner paused":"Banner resumed"); render(); },
  bannerDel(el){ const b = BANNERS.find(x=>x.id===+el.dataset.id);
    modal({title:`Delete the ${b.advertiser} banner?`, submit:"Delete", danger:true, body:`<p style="margin:0">Its stats (${fmt(b.imps)} impressions, ${fmt(b.clicks)} clicks) stay in the audit log.</p>`,
      onSubmit: () => { BANNERS = BANNERS.filter(x=>x!==b); audit("Advertising change", `banner: ${b.advertiser}`, `Deleted (${b.imps} imps, ${b.clicks} clicks)`, "exists", "deleted"); }}); },
  deleteAccount(){ modal({title:"Delete your account?", submit:"Delete account", danger:true, body:`<p style="margin:0">Your profile is removed after a 30-day grace period. Posts stay but show as “deleted user”. Type your username to confirm.</p><label>Username<input name="u"></label>`,
    onSubmit: f => { if (val(f,"u")!==S.user) return "Type your username exactly to confirm."; toast("Deletion scheduled. Sign in within 30 days to cancel."); }}); }
};

const FORMS = {
  reply(f){ const t = topic(f.dataset.topic), body = f.elements.body.value.trim();
    if (!can("topic")) return toast("Your account can't post right now.");
    const pr = contentProblem(body); if (pr) return toast(pr);
    const p = P(S.user, body, Date.now()); t.posts.push(p); me().posts++;
    const quoted = (body.match(/\[quote=([\w-]+)\]/)||[])[1];
    if (quoted) notify(quoted,"quote",`${S.user} quoted you in “${t.title}”`,"/topic/"+t.id);
    (body.match(/@([a-z0-9_]+)/gi)||[]).forEach(m=>notify(m.slice(1),"mention",`${S.user} mentioned you in “${t.title}”`,"/topic/"+t.id));
    notify(t.author,"reply",`${S.user} replied in “${t.title}”`,"/topic/"+t.id);
    Object.entries(FOLLOWS).forEach(([u,s])=>{ if (s.has("topic:"+t.id) && u!==t.author) notify(u,"reply",`New reply in “${t.title}”`,"/topic/"+t.id); });
    S.ui.pages = S.ui.pages||{}; S.ui.pages["t:"+t.id] = Math.ceil(visiblePosts(t).length/10);
    render(); const el = document.getElementById("post-"+p.id); if (el) el.scrollIntoView({block:"center"}); toast("Reply posted"); },
  vote(f){ const t = topic(f.dataset.topic), picked = $$("input[name=opt]:checked", f).map(x=>+x.value);
    if (!picked.length) return toast("Pick an option."); t.poll.options.forEach(o=>o.v.delete(S.user)); picked.forEach(i=>t.poll.options[i].v.add(S.user)); toast("Vote counted"); render(); },
  dir(){},
  caseReply(f){ const c = COMPLAINTS.find(x=>x.id===f.dataset.id), b = f.elements.body.value.trim(), att = filesOf(f.elements.files);
    if (!b) return toast("Write a message first."); const pr = contentProblem(b); if (pr) return toast(pr);
    if (tooBig(att)) return toast(`${tooBig(att).name} is over 10 MB.`);
    c.messages.push(CM(S.user, b, Date.now())); att.forEach(a=>c.evidence.push({name:a.name, public:false}));
    const role = caseRole(c, S.user), o = op(c.op);
    if (role === "casino" && c.status === "Awaiting Business") setCaseStatus(c, "Under Investigation", "Operator replied", {quiet:true});
    if (role === "player" && c.status === "Awaiting User") setCaseStatus(c, "Under Investigation", "Player replied", {quiet:true});
    new Set([c.user, ...o.reps, c.specialist, ...c.followers].filter(Boolean)).forEach(u => notify(u, "complaint", `New message in ${c.id} from ${role === "casino" ? o.name : S.user}`, "/complaints/"+c.id));
    render(); toast("Posted"); },
  modNote(f){ const c = COMPLAINTS.find(x=>x.id===f.dataset.id), b = f.elements.body.value.trim(); if (!b) return; c.modNotes.push({by:S.user, at:Date.now(), text:b}); render(); },
  search(f){ S.ui.sf = Object.assign(S.ui.sf||{}, {board:f.elements.board.value, author:f.elements.author.value.trim(), date:f.elements.date.value, rating:+f.elements.rating.value}); go("/search?q="+encodeURIComponent(f.elements.q.value.trim())); },
  sendMsg(f){ const c = CONVS.find(x=>x.id===+f.dataset.conv), body = f.elements.body.value.trim(), att = filesOf(f.elements.files);
    if (!body && !att.length) return toast("Write a message or attach a file.");
    if (tooBig(att)) return toast(`${tooBig(att).name} is over the 10 MB limit.`);
    {
      const b = convBlocked(c); if (b) return toast(b);
      if (restricted("pm") && c.members.some(m=>m!==S.user&&!isStaffUser(m)) && counter("pm") >= LIMITS.newPmsPerDay) return toast(`New members can message ${LIMITS.newPmsPerDay} members a day. Messages to moderators and admins are unlimited.`);
      if (body){ const pr = contentProblem(body); if (pr) return toast(pr); }
    }
    const notice = !!(f.elements.notice && f.elements.notice.checked && mp("dm.notice"));
    postMessage(c, body, att, notice); render(); $("#msgBody")?.focus(); },
  userLookup(f){ const u = f.elements.u.value.trim(); if (USERS[u]) go("/members/"+u); else toast(`No member called ${u}.`); },
  addLeague(f){ const n = f.elements.name.value.trim(); if (!n) return toast("Name the league."); const slug = slugify(n); if (league(slug)) return toast("That league exists.");
    let bslug = null; if (f.elements.board.checked){ bslug = slug; BOARDS.push(B(slug, n, `${n} discussion`, "sports", {order:99})); }
    LEAGUES.push({slug, name:n, sport:f.elements.sport.value, country:f.elements.country.value.trim()||"—", season:f.elements.season.value.trim(), board:bslug||"general"});
    audit("Sports entity added",`league ${n}`,"Admin","none","created"); go("/leagues/"+slug); },
  addTeam(f){ const n = f.elements.name.value.trim(), sh = f.elements.short.value.trim().toUpperCase(); if (!n||!sh) return toast("Name and short code are required."); const slug = slugify(n); if (team(slug)) return toast("That team exists.");
    TEAMS.push({slug, name:n, short:sh, league:f.elements.league.value, country:league(f.elements.league.value).country, stadium:f.elements.stadium.value.trim()||"—", founded:+f.elements.founded.value||"—", color:f.elements.color.value});
    audit("Sports entity added",`team ${n}`,"Admin","none","created"); go("/teams/"+slug); },
  safetyWeights(f){ const w = Object.fromEntries(Object.keys(SAFETY_W).map(k=>[k, Math.max(0, +f.elements["s_"+k].value||0)])); const sum = Object.values(w).reduce((a,b)=>a+b,0);
    if (sum !== 100) return toast(`Safety Index weights add up to ${sum}%. They need to total 100.`);
    const prev = JSON.stringify(SAFETY_W); SAFETY_W = w; audit("Rating adjustment","Safety Index weights","Admin change",prev,JSON.stringify(w)); toast("Safety Index weights saved"); render(); },
  weights(f){ const w = Object.fromEntries(Object.keys(WEIGHTS).map(k=>[k, Math.max(0, +f.elements[k].value||0)])); const sum = Object.values(w).reduce((a,b)=>a+b,0);
    if (sum !== 100) return toast(`Weights add up to ${sum}%. They need to total 100.`); const prev = JSON.stringify(WEIGHTS); WEIGHTS = w; audit("Rating adjustment","Trust score weights","Admin change",prev,JSON.stringify(w)); toast("Weights saved. Scores updated everywhere."); render(); },
  profile(f){ const u = me(); u.about = f.elements.about.value.trim(); u.website = f.elements.website.value.trim(); u.favTeams = [...f.elements.teams.selectedOptions].map(o=>o.value); toast("Profile saved"); render(); }
};

const CHANGE = {
  lgSport(el){ S.ui.lgSport = el.value; render(); },
  starPick(el){ const l = $("#spLabel"); if (l) l.textContent = `${el.value} of 5: ${RATE_LABEL[el.value]}`; },
  dirCountry(el){ S.ui.dir = Object.assign(S.ui.dir||{}, {country:el.value}); render(); },
  dirSort(el){ S.ui.dir = Object.assign(S.ui.dir||{}, {sort:el.value}); render(); },
  attachPick(el){ const n = $("#attNames"); if (n) n.textContent = el.files.length ? "Attached: " + [...el.files].map(x=>x.name).join(", ") : ""; },
  setRole(el){ const u = USERS[el.dataset.user], prev = u.role; u.role = el.value;
    if (["moderator","senior_moderator"].includes(u.role)){ const p = modProfile(u.name); p.template = u.role === "senior_moderator" ? "senior" : (p.template === "senior" ? "board" : p.template); }
    else { BOARDS.forEach(b => b.mods = b.mods.filter(m=>m!==u.name)); delete MOD_PROFILES[u.name]; } audit("Permission change", u.name, "Role change", roleLabel(prev), roleLabel(u.role)); notify(u.name,"moderator",`Your role is now ${roleLabel(u.role)}`,"/members/"+u.name); toast(`${u.name} is now ${roleLabel(u.role)}`); },
  rank(el){ RANKS[+el.dataset.i].min = Math.max(0, +el.value||0); toast("Rank threshold saved"); },
  perm(el){ const prev = PERMS[el.dataset.cap][el.dataset.role]; const v = el.value==="r" ? "r" : +el.value; PERMS[el.dataset.cap][el.dataset.role] = v;
    audit("Permission change", `${CAPS.find(c=>c.id===el.dataset.cap).label} · ${roleLabel(el.dataset.role)}`, "Matrix edit", String(prev), String(v)); toast("Permission updated"); renderShell(); },
  limit(el){ LIMITS[el.dataset.k] = Math.max(0, +el.value||0); audit("Permission change", el.dataset.k, "Limit edit", "", String(LIMITS[el.dataset.k])); toast("Limit saved"); },
  setting(el){
    if (el.dataset.k === "scoresUrl" && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(el.value.trim())) { toast("Enter a full https:// address."); el.value = SETTINGS.scoresUrl; return; }
    SETTINGS[el.dataset.k] = el.type==="number" ? +el.value : el.value.trim(); renderShell(); renderFooter(); toast("Saved"); },
  scoresUtm(el){ SETTINGS.scoresUtm = el.checked; renderShell(); renderFooter(); toast("Saved"); },
  tagIndex(el){ TAGS[+el.dataset.i].index = el.checked; toast(el.checked?"Tag page indexed":"Tag page set to noindex"); },
  opFlag(el){ const o = op(el.dataset.slug), k = el.dataset.k, prev = o[k]; o[k] = el.checked; audit(k==="verified"?"Business verification":"Commercial setting", o.name, `${k} toggled`, String(prev), String(o[k])); toast("Saved"); },
  listingFeat(el){ const l = LISTINGS.find(x=>x.id===+el.dataset.id); l.featured = el.checked; l.featureReq = false; toast("Saved"); },
  seo(el){ const r = SEO[+el.dataset.i]; r[el.dataset.k] = el.type==="checkbox" ? el.checked : el.value; toast("SEO setting saved"); },
  navOn(el){ NAV[+el.dataset.i].on = el.checked; renderShell(); },
  navLabel(el){ NAV[+el.dataset.i].label = el.value || NAV[+el.dataset.i].label; renderShell(); },
  outage(el){ SETTINGS.providerOk = !el.checked; render(); },
  ageGate(el){ SETTINGS.ageGate = el.checked; toast(el.checked?"Age gate on":"Age gate off"); },
  domains(el){ SETTINGS.bannedDomains = el.value.split("\n").map(s=>s.trim()).filter(Boolean); toast("Blocked domains saved"); },
  privDms(el){ me().privacy.dms = el.value; toast("Message privacy saved"); },
  privAct(el){ me().privacy.showActivity = el.checked; toast("Saved"); },
  notify(el){ me().notify[el.dataset.k] = el.checked; toast("Saved"); }
};
Object.assign(CHANGE, {
  modTpl(el){ const name = el.dataset.user, p = modProfile(name), prev = modTemplate(name).name, t = MOD_TEMPLATES.find(x=>x.id===el.value);
    p.template = t.id; p.allow = new Set(); p.deny = new Set(); USERS[name].role = t.allBoards ? "senior_moderator" : "moderator";
    audit("Permission change", name, "Template changed (personal changes reset)", prev, t.name); toast(`${name} now uses “${t.name}”`); render(); },
  modSusp(el){ const p = modProfile(el.dataset.user), prev = p.suspendMaxDays; p.suspendMaxDays = Math.min(365, Math.max(1, +el.value||7)); audit("Permission change", el.dataset.user, "Max suspension length", `${prev} days`, `${p.suspendMaxDays} days`); toast("Saved"); },
  tplPerm(el){ const t = MOD_TEMPLATES.find(x=>x.id===el.dataset.id), k = el.dataset.k; el.checked ? t.perms.add(k) : t.perms.delete(k);
    audit("Permission change", `template ${t.name}`, `${el.checked?"Granted":"Removed"}: ${modLabel(k)}`, el.checked?"off":"on", el.checked?"on":"off"); toast(`${t.name}: ${el.checked?"granted":"removed"} “${modLabel(k)}”`); }
});
Object.assign(CHANGE, {
  hubCountry(el){ S.ui.hub = Object.assign(S.ui.hub||{}, {country:el.value}); render(); },
  hubPay(el){ S.ui.hub = Object.assign(S.ui.hub||{}, {pay:el.value}); render(); },
  hubSort(el){ S.ui.hub = Object.assign(S.ui.hub||{}, {sort:el.value}); render(); },
  cOp(el){ S.ui.cop = el.value; if (S.path.includes("?op=")) S.path = "/complaints"; render(); },
  bannerSecs(el){ SETTINGS.bannerSecs = Math.min(30, Math.max(3, +el.value||6)); toast(`Banners rotate every ${SETTINGS.bannerSecs} seconds`); },
  bannerImg(el){ const file = el.files && el.files[0]; if (!file) return; if (file.size > 2e6){ toast("Image must be under 2 MB."); el.value = ""; return; }
    const r = new FileReader(); r.onload = () => { S.ui.bannerImg = r.result; }; r.readAsDataURL(file); }
});

/* ---------- Banner rotation ---------- */
function adShow(i){
  const root = $("#adBanner"); if (!root) return;
  const slides = $$(".ad-slide", root); if (!slides.length) return;
  AD.i = (i + slides.length) % slides.length;
  slides.forEach((sl,k) => { const on = k === AD.i; sl.classList.toggle("on", on);
    if (on){ sl.removeAttribute("aria-hidden"); sl.removeAttribute("tabindex"); } else { sl.setAttribute("aria-hidden","true"); sl.setAttribute("tabindex","-1"); } });
  $$(".ad-dot", root).forEach((d,k) => k === AD.i ? d.setAttribute("aria-current","true") : d.removeAttribute("aria-current"));
  const b = BANNERS.find(x => x.id === AD.list[AD.i]); if (b) b.imps++;
}
function adStart(){
  clearInterval(AD.timer);
  const root = $("#adBanner"); if (!root) return;
  const b = BANNERS.find(x => x.id === AD.list[AD.i]); if (b) b.imps++;
  root.addEventListener("mouseenter", () => AD.hover = true); root.addEventListener("mouseleave", () => AD.hover = false);
  root.addEventListener("focusin", () => AD.hover = true); root.addEventListener("focusout", () => AD.hover = false);
  AD.timer = setInterval(() => {
    if (!$("#adBanner")){ clearInterval(AD.timer); return; }
    if (AD.paused || AD.hover || document.hidden) return;
    adShow(AD.i + 1);
  }, (SETTINGS.bannerSecs || 6) * 1000);
}
if (matchMedia("(prefers-reduced-motion: reduce)").matches) AD.paused = true;
document.addEventListener("click", e => {
  const n = e.target.closest("[data-adnav]"), g = e.target.closest("[data-adgo]"), pz = e.target.closest("[data-adpause]");
  if (n) adShow(AD.i + +n.dataset.adnav);
  if (g) adShow(+g.dataset.adgo);
  if (pz){ AD.paused = !AD.paused; pz.textContent = AD.paused ? "▶" : "❚❚"; pz.setAttribute("aria-label", (AD.paused?"Play":"Pause") + " banner rotation"); }
});

const INPUT = {
  cq(el){ S.ui.cq = el.value; render(); },
  mq(el){ S.ui.mq = el.value; render(); },
  memq(el){ S.ui.memq = el.value; render(); },
  msgQ(el){ S.ui.msgQ = el.value; render(); },
  draft(el){ (S.ui.drafts||(S.ui.drafts={}))[el.dataset.conv] = el.value; }
};

/* ---------- Render ---------- */
function render(){
  const ae = document.activeElement, fid = ae && ae.id && $("#view").contains(ae) ? ae.id : null;
  let sel = null; try { if (fid && ae.selectionStart != null) sel = [ae.selectionStart, ae.selectionEnd]; } catch(e){}
  const {seg, qs} = parse(S.path), s1 = seg[1];
  let h = typeof liveGate === "function" ? liveGate(seg, qs) : null;
  if (h === null) switch (seg[0] || ""){
    case "": h = vHome(); break;
    case "forum": h = s1 ? vBoard(s1) : vForum(); break;
    case "topic": { const t = topic(s1); h = t && t.deleted && t.mergedInto ? vTopic(t.mergedInto) : vTopic(s1); break; }
    case "tag": h = vTag(s1); break;
    case "sports": h = vSportsHub(s1 || "all"); break;
    case "leagues": h = s1 ? vLeague(s1) : vSportsHub(); break;
    case "teams": h = s1 ? vTeam(s1) : vSportsHub(); break;
    case "events": h = vEvent(s1); break;
    case "live": h = vLive(); break;
    case "gambling": h = vGambling(); break;
    case "reviews": h = vGambling(); break;
    case "casinos": h = s1 ? vOperator(s1, qs) : vHub(qs); break;
    case "sportsbooks": h = s1 ? vOperator(s1, qs) : vHub(qs); break;
    case "blacklist": h = vBlacklist(); break;
    case "go": { const gl = AFF_LINKS.find(x => x.slug === s1); if (gl && gl.status === "active" && S.ui.lastGo !== S.path){ S.ui.lastGo = S.path; logAffClick(gl, qs.p || "direct"); } h = vGo(s1, qs); break; }
    case "complaints": h = s1 ? vComplaint(s1, qs) : vComplaints(qs); break;
    case "marketplace": h = s1 === "listing" ? vListing(seg[2]) : vMarket(qs); break;
    case "escrow": h = s1 ? vEscrow(s1) : vEscrowList(); break;
    case "get-verified": h = vVerifySeller(); break;
    case "crypto": h = vCrypto(); break;
    case "community": h = vCommunity(); break;
    case "members": h = s1 ? vProfile(s1) : vMembers(); break;
    case "staff": h = vStaff(); break;
    case "search": h = vSearch(qs); break;
    case "notifications": h = vNotifications(); break;
    case "messages": h = vMessages(s1); break;
    case "mod": h = vMod(); break;
    case "admin": h = vAdmin(s1); break;
    case "settings": h = vSettings(); break;
    case "page": h = s1 === "safety-index" ? vSafetyPage() : s1 === "escrow" ? vEscrowHow() : vPage(s1); break;
    default: h = vMissing("Page not found.");
  }
  const u = me();
  const banner = u && u.status !== "active" ? `<div class="notice red" style="margin-bottom:16px"><strong>Account ${esc(u.status)}.</strong><span>You can read and message moderators and admins, but you can't post, review or message other members.</span><button class="btn small" type="button" data-act="appeal">Appeal</button></div>`
    : u && restricted("topic") ? `<div class="notice" style="margin-bottom:16px"><strong>New member.</strong><span>Welcome! For now you can start ${LIMITS.newTopicsPerDay} topics and message ${LIMITS.newPmsPerDay} members a day, without links. You can message ${link("/staff","moderators and admins")} any time.</span></div>` : "";
  const sub = sectionSubnav();
  $("#view").innerHTML = banner + sub + h;
  renderShell(); adStart(); renderChrome();
  if (fid){ const el = document.getElementById(fid); if (el){ el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch(e){} } }
  const tb = $("#tb"); if (tb) tb.scrollTop = tb.scrollHeight;
  const mb = $("#msgBody"); if (mb){ const cid = mb.closest("form").dataset.conv; mb.dataset.input = "draft"; mb.dataset.conv = cid; mb.value = (S.ui.drafts||{})[cid] || ""; }
}

/* ---------- Permission guard ----------
   Every moderator action re-checks its permission when clicked. In production the
   same check runs on the server for every API call (spec §36: object-level authorization). */
const GUARD = {
  modTopic: el => ({pin:"topic.pin",lock:"topic.lock",move:"topic.move",merge:"topic.merge",archive:"topic.archive",tags:"topic.tags",delete:"topic.delete"})[el.dataset.op],
  hidePost: () => "post.hide", split: () => "topic.merge", reviewStatus: () => "review.moderate", approveListing: () => "queue.listings", rejectListing: () => "queue.listings", caseStatus: () => "complaint.manage", caseOutcome: () => "complaint.manage", caseTake: () => "complaint.manage",
  setWarning: () => "operator.warning", blacklistOp: () => "operator.warning", unblacklist: () => "operator.warning", removeListing: () => "listing.remove", createMatchThread: () => "topic.matchThread",
  editPost: el => { const t = topic(el.dataset.topic), p = t && t.posts.find(x=>x.id===+el.dataset.post); return p && p.author !== S.user ? "post.edit" : null; }
};

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) && g.getAttribute("href") !== "#") return;   // let the browser open a new tab
  if (g && !g.closest("dialog")){ e.preventDefault(); go(g.dataset.go); return; }
  if (g && g.closest("dialog")){ e.preventDefault(); closeModal(); go(g.dataset.go); return; }
  const a = e.target.closest("[data-act]");
  if (a && GUARD[a.dataset.act]){ const key = GUARD[a.dataset.act](a); if (key && !mp(key)){ e.preventDefault(); toast("Your moderator permissions don't include this action."); return; } }
  if (a && ACT[a.dataset.act]){
    if (a.tagName === "A") e.preventDefault();
    if (a.type === "checkbox") { ACT[a.dataset.act](a, e); return; }
    if (a.closest("dialog") && a.dataset.act === "resetPw"){ e.preventDefault(); closeModal(); }
    ACT[a.dataset.act](a, e);
  }
});
document.addEventListener("submit", e => {
  const f = e.target.closest("[data-form]");
  if (f && FORMS[f.dataset.form]){ e.preventDefault(); FORMS[f.dataset.form](f); }
});
document.addEventListener("change", e => { const el = e.target.closest("[data-change]"); if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el); });
document.addEventListener("input", e => { const el = e.target.closest("[data-input]"); if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el); });
document.addEventListener("keydown", e => {
  if (e.target.id === "msgBody" && e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); e.target.closest("form").requestSubmit(); }
});
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); S.ui.sf = {type:"all"}; go("/search?q=" + encodeURIComponent($("#q").value.trim())); });
$("#role").addEventListener("change", e => { setRole(e.target.value); toast(S.user ? `Viewing as ${roleLabel(S.role)} (${S.user})` : "Viewing as Guest"); render(); });
// The demo role switcher only appears with ?demo=1 in the address. Everyone else signs in normally.
try { if (!LIVE && new URLSearchParams(location.search).has("demo")) $("#demoBar").hidden = false; } catch(e) {}

/* ---------- Init ---------- */
function appInit(){
$("#role").innerHTML = ROLES.map(r=>`<option value="${r.id}">${r.label}</option>`).join("");
const dl = document.createElement("div");
dl.innerHTML = `<datalist id="ac">${[...TEAMS.map(t=>t.name),...LEAGUES.map(l=>l.name),...OPERATORS.map(o=>o.name)].map(n=>`<option value="${esc(n)}">`).join("")}</datalist><datalist id="aclist-users">${Object.keys(USERS).map(n=>`<option value="${n}">`).join("")}</datalist>`;
document.body.appendChild(dl);
$("#q").setAttribute("list","ac");
if (!LIVE) setRole("guest");
renderFooter();
render();
// Arriving from the live scores site with ?join=1 opens the sign-up form.
try { if (new URLSearchParams(location.search).get("join")) ACT.register(); } catch(e) {}
if (!LIVE) setInterval(() => { const el = $("#online"); if (el){ const n = +el.textContent.replace(/,/g,""); el.textContent = fmt(Math.max(3000, n + Math.round((Math.random()-.45)*18))); } }, 4000);
}

/* =====================================================================
   ESCROW ACTIONS
   In production each step is a signed transaction against the escrow
   contract, confirmed by a chain watcher; here they're simulated.
   ===================================================================== */
const validWallet = (kind, a) => kind === "tron" ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
function escrowNotify(e, text, who){ (who || [e.buyer, e.seller]).forEach(u => notify(u, "market", text, "/escrow/" + e.id)); }
function closeEscrowReports(e, status){
  REPORTS.filter(r => r.kind === "escrowDispute" && r.target.escrow === e.id && r.status === "open").forEach(r => { r.status = status; r.closedBy = S.user || "system"; r.closedAt = Date.now(); });
}
// Final payout: release to seller, refund to buyer, or split. Updates the listing and seller reputation.
function finishEscrow(e, status, by, text, split){
  const l = LISTINGS.find(x => x.id === e.listing);
  e.status = status; e.deadline = null; e.payoutTx = fakeTx(e.network);
  e.events.push(EV(Date.now(), by, text, e.payoutTx));
  if (l){
    if (status === "released" || status === "split"){ l.status = "Sold"; USERS[e.seller].rep.market += status === "released" ? 3 : 1; }
    if (status === "refunded") l.status = "Available";
  }
  closeEscrowReports(e, "resolved");
  escrowNotify(e, `Escrow ${e.id}: ${ESCROW_STATUS[status].label.toLowerCase()}${split ? ` (${usd(split.toBuyer)} to ${e.buyer}, ${usd(split.toSeller)} to ${e.seller})` : ""}`);
}

Object.assign(ACT, {
  buyEscrow(el){
    const l = LISTINGS.find(x => x.id === +el.dataset.id);
    if (!signedIn()) return needSignIn("Sign in to buy with escrow.");
    if (l.seller === S.user) return toast("That's your own listing.");
    if (S.role === "new_member") return toast(`Escrow unlocks after your first ${LIMITS.newMemberPostsToGraduate} posts.`);
    if (me().status !== "active") return toast(`Your account is ${me().status}.`);
    const chk = escrowCheck(l); if (!chk.ok) return toast(chk.why);
    if (openEscrowFor(l)) return toast("Someone else is already paying for this through escrow.");
    const nets = sellerNetworks(l.seller), fee = escrowFee(l.usd), w = me().wallets || {};
    modal({title:"Pay with escrow", submit:"Create escrow deal", body:`
      <p style="margin:0"><strong>${esc(l.title)}</strong> from ${esc(l.seller)}</p>
      <label>Pay with<select name="net" data-change="escNet">${nets.map(n=>`<option value="${n.id}">${n.token} on ${n.chain} · ~$${n.gasUsd.toFixed(2)} network fee</option>`).join("")}</select></label>
      <div class="panel" style="padding:12px"><dl class="kv"><dt>Item</dt><dd>${usd(l.usd)}</dd><dt>Escrow fee <span class="muted">(${feeRule()})</span></dt><dd>${usd(fee)}</dd><dt>You pay</dt><dd><strong>${usd(l.usd + fee)}</strong> <span id="escTok">${nets[0].token}</span></dd></dl></div>
      <label>Your refund wallet <span class="hint">Where money goes back if you're refunded. Must be a <span id="escKind">${nets[0].id==="tron"?"Tron (T…)":"Base/Polygon (0x…)"}</span> address you control.</span>
        <input name="wallet" class="mono" value="${esc(w[walletKey(nets[0].id)] || "")}" autocomplete="off" spellcheck="false"></label>
      <label>Delivery details <span class="hint">Optional. Shared with ${esc(l.seller)} only.</span><textarea name="note" style="min-height:60px" placeholder="Address or how you'd like it delivered"></textarea></label>
      <label class="chk"><input type="checkbox" name="agree"> I'll release payment when I receive the item, or open a dispute within ${ESCROW_SETTINGS.autoReleaseDays} days of delivery</label>`,
      onSubmit: f => {
        const net = val(f,"net"), wallet = val(f,"wallet"), kind = walletKey(net);
        if (!validWallet(kind, wallet)) return kind === "tron" ? "Enter a valid Tron address. It starts with T and is 34 characters." : "Enter a valid wallet address. It starts with 0x and is 42 characters.";
        if (!f.elements.agree.checked) return "Tick the box to accept the escrow terms.";
        me().wallets = Object.assign(me().wallets || {}, {[kind]: wallet});
        const e = mkEscrow({listing:l.id, buyer:S.user, seller:l.seller, amount:l.usd, network:net, status:"awaiting", createdAt:Date.now(), buyerWallet:wallet,
          sellerWallet:USERS[l.seller].wallets[kind], events:[EV(Date.now(), S.user, "Deal created")]});
        if (val(f,"note")) e.events.push(EV(Date.now(), S.user, "Delivery details: " + val(f,"note")));
        ESCROWS.push(e);
        notify(l.seller, "market", `${S.user} started an escrow deal for “${l.title}”. Wait for the deposit before sending anything.`, "/escrow/" + e.id);
        nav("/escrow/" + e.id); toast("Escrow deal created. Send your deposit to lock it in.");
      }});
  },
  escrowDeposit(el){ const e = escrowOf(el.dataset.id); if (e.buyer !== S.user || e.status !== "awaiting") return;
    e.status = "funded"; e.events.push(EV(Date.now(), S.user, `Deposited ${usd(escrowTotal(e))} ${e.token} into the escrow contract`, fakeTx(e.network)));
    const l = LISTINGS.find(x => x.id === e.listing); if (l) l.status = "Pending";
    notify(e.seller, "market", `${S.user} paid ${usd(escrowTotal(e))} ${e.token} into escrow. Send the item and mark it shipped.`, "/escrow/" + e.id);
    toast("Deposit confirmed on " + e.chain); render(); },
  escrowCancel(el){ const e = escrowOf(el.dataset.id);
    modal({title:"Cancel this deal?", submit:"Cancel deal", danger:true, body:"<p style='margin:0'>No money has been sent, so nothing needs refunding.</p>",
      onSubmit: () => { e.status = "cancelled"; e.events.push(EV(Date.now(), S.user, "Cancelled before deposit")); notify(e.seller, "market", `${S.user} cancelled escrow ${e.id}`, "/escrow/" + e.id); }}); },
  escrowShip(el){ const e = escrowOf(el.dataset.id);
    modal({title:"Mark as shipped or delivered", submit:"Confirm", body:`<label>How did you send it? <span class="hint">Tracking number, courier, or how a digital item was delivered</span><textarea name="t" required style="min-height:70px"></textarea></label>
      <p class="hint" style="margin:0">The payment releases to you automatically in ${ESCROW_SETTINGS.autoReleaseDays} days unless ${esc(e.buyer)} confirms sooner or opens a dispute.</p>`,
      onSubmit: f => { if (val(f,"t").length < 4) return `Add tracking or delivery details so ${e.buyer} can check.`;
        e.status = "shipped"; e.deadline = Date.now() + ESCROW_SETTINGS.autoReleaseDays * DAY; e.events.push(EV(Date.now(), S.user, "Marked as shipped · " + val(f,"t")));
        notify(e.buyer, "market", `${S.user} has sent your item (escrow ${e.id}). Release payment when it arrives.`, "/escrow/" + e.id); }}); },
  escrowRelease(el){ const e = escrowOf(el.dataset.id);
    modal({title:`Release payment to ${e.seller}?`, submit:`Release ${usd(e.amount)} ${e.token}`, body:`<p style="margin:0">Only do this once you have the item and it's as described. Released payments can't be reversed.</p>`,
      onSubmit: () => { finishEscrow(e, "released", S.user, `Confirmed received. ${usd(e.amount)} ${e.token} released to ${e.seller}`); toast("Payment released. Leave them feedback."); }}); },
  escrowRefund(el){ const e = escrowOf(el.dataset.id);
    modal({title:`Refund ${e.buyer}?`, submit:`Refund ${usd(e.amount)} ${e.token}`, danger:true, body:`<p style="margin:0">The full ${usd(e.amount)} ${e.token} goes back to ${esc(e.buyer)} and the listing becomes available again.</p>`,
      onSubmit: () => { finishEscrow(e, "refunded", S.user, `${S.user} issued a refund. ${usd(e.amount)} ${e.token} returned to ${e.buyer}`); }}); },
  escrowDispute(el){ const e = escrowOf(el.dataset.id);
    modal({title:"Open a dispute", submit:"Open dispute", danger:true, body:`
      <label>What's wrong?<select name="r">${["Item not received","Item not as described","Damaged in delivery","Counterfeit or fake signature","They stopped responding","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label>
      <label>Explain what happened<textarea name="d" required placeholder="Dates, what you received, what you've tried with the seller"></textarea></label>
      <p class="hint" style="margin:0">The money stays locked. An escrow arbiter reviews both sides and decides. Talk to them first if you haven't.</p>`,
      onSubmit: f => { if (val(f,"d").length < 20) return "Explain what happened in a sentence or two.";
        e.status = "disputed"; e.deadline = null; e.dispute = {by:S.user, at:Date.now(), reason:val(f,"r"), detail:val(f,"d")};
        e.events.push(EV(Date.now(), S.user, "Opened a dispute: " + val(f,"r")));
        REPORTS.push({id:++reportSeq, queue:"market", kind:"escrowDispute", target:{escrow:e.id}, board:null, reason:"Escrow dispute: " + val(f,"r"), by:S.user, at:Date.now(), status:"open"});
        notify(e.seller, "market", `${S.user} opened a dispute on escrow ${e.id}. Add your side of the story.`, "/escrow/" + e.id); }}); },
  escrowDecide(el){ const e = escrowOf(el.dataset.id);
    askReason(`Decide escrow ${e.id}`, (r, f) => {
      const o = f.elements.o.value, pct = Math.min(100, Math.max(0, +f.elements.pct.value || 0));
      if (o === "release") finishEscrow(e, "released", S.user, `Arbiter released ${usd(e.amount)} ${e.token} to ${e.seller}`);
      else if (o === "refund") finishEscrow(e, "refunded", S.user, `Arbiter refunded ${usd(e.amount)} ${e.token} to ${e.buyer}`);
      else { const toBuyer = Math.round(e.amount * pct) / 100, toSeller = Math.round((e.amount - toBuyer) * 100) / 100;
        e.decision = {toBuyer, toSeller}; finishEscrow(e, "split", S.user, `Arbiter split the payment: ${usd(toBuyer)} to ${e.buyer}, ${usd(toSeller)} to ${e.seller}`, {toBuyer, toSeller}); }
      e.decision = Object.assign(e.decision || {}, {by:S.user, at:Date.now(), reason:r, outcome:o});
      audit("Escrow decision", e.id, r, "disputed", e.status);
    }, {submit:"Record decision", extra:`<p class="muted" style="margin:0">The contract can only pay out, refund, or split between the two of them. This can't be undone.</p>
      <label>Decision<select name="o"><option value="refund">Refund ${esc(e.buyer)} in full</option><option value="release">Pay ${esc(e.seller)} in full</option><option value="split">Split the payment</option></select></label>
      <label>If splitting: % refunded to ${esc(e.buyer)}<input name="pct" type="number" min="0" max="100" value="50"></label>`}); },
  escrowSkip(el){ const e = escrowOf(el.dataset.id); if (e.status !== "shipped") return; e.deadline = Date.now() - 1; render(); toast("Skipped ahead. The payment auto-released."); },
  copyText(el){ const t = el.dataset.text;
    const done = () => toast("Copied"); const fail = () => { modal({title:"Copy this", submit:null, cancel:"Close", body:`<input class="inp mono" value="${esc(t)}" readonly onfocus="this.select()">`}); };
    try { navigator.clipboard.writeText(t).then(done, fail); } catch(e){ fail(); } }
});
Object.assign(FORMS, {
  escrowNote(f){ const e = escrowOf(f.dataset.id), b = f.elements.body.value.trim(); if (!b) return;
    const pr = contentProblem(b); if (pr) return toast(pr);
    e.events.push(EV(Date.now(), S.user, (e.status === "disputed" ? "Evidence: " : "Note: ") + b));
    [e.buyer, e.seller].filter(u => u !== S.user).forEach(u => notify(u, "market", `New ${e.status === "disputed" ? "evidence" : "note"} on escrow ${e.id}`, "/escrow/" + e.id));
    render(); },
  escrowSettings(f){ const S_ = ESCROW_SETTINGS, fee = +f.elements.fee.value, days = +f.elements.days.value, min = +f.elements.min.value, max = +f.elements.max.value;
    if (!(fee >= 0 && fee <= 10)) return toast("Fee must be between 0 and 10%.");
    if (!(min > 0 && max > min)) return toast("Max deal must be bigger than min deal.");
    const nets = S_.networks.filter(n => f.elements["net_" + n.id].checked); if (!nets.length) return toast("Keep at least one network on.");
    const feeMin = +f.elements.feeMin.value; if (!(feeMin >= 0)) return toast("Minimum fee can't be negative.");
    const prev = `${S_.feePct}% / min $${S_.feeMin} · ${S_.autoReleaseDays}d · $${S_.minUsd}–${S_.maxUsd}`;
    S_.feePct = fee; S_.feeMin = feeMin; S_.autoReleaseDays = Math.max(1, days|0); S_.minUsd = min; S_.maxUsd = max;
    S_.networks.forEach(n => n.on = f.elements["net_" + n.id].checked);
    S_.boards = new Set(BOARDS.filter(b => b.kind === "listing" && f.elements["b_" + b.slug] && f.elements["b_" + b.slug].checked).map(b => b.slug));
    audit("Escrow settings", "Marketplace escrow", "Admin change", prev, `${S_.feePct}% / min $${S_.feeMin} · ${S_.autoReleaseDays}d · $${S_.minUsd}–${S_.maxUsd}`);
    toast("Escrow settings saved"); render(); }
});
Object.assign(CHANGE, {
  escNet(el){ const id = el.value, n = netOf(id), f = el.form, w = me().wallets || {};
    $("#escTok").textContent = n.token; $("#escKind").textContent = id === "tron" ? "Tron (T…)" : "Base/Polygon (0x…)";
    f.elements.wallet.value = w[walletKey(id)] || ""; },
  payoutWallet(el){ const kind = el.dataset.k, v = el.value.trim(), u = me(); u.wallets = u.wallets || {};
    if (!v){ delete u.wallets[kind]; toast("Payout wallet removed"); return; }
    if (!validWallet(kind, v)) return toast(kind === "tron" ? "That isn't a valid Tron address. It starts with T and is 34 characters." : "That isn't a valid address. It starts with 0x and is 42 characters.");
    u.wallets[kind] = v; toast("Payout wallet saved"); }
});
Object.assign(GUARD, { escrowDecide: () => "escrow.arbitrate" });

/* =====================================================================
   SELLER VERIFICATION ACTIONS
   In production: phone codes via an SMS provider, ID + selfie via a
   KYC provider (document + liveness check); Pitchside stores pass/fail only.
   ===================================================================== */
function closeSellerQueue(name, status){
  REPORTS.filter(r=>r.kind==="sellerVerify" && r.target.user===name && r.status==="open").forEach(r=>{ r.status=status; r.closedBy=S.user; r.closedAt=Date.now(); });
}
Object.assign(ACT, {
  verifStep(el){
    const u = me(), v = u.sellerVerif, step = el.dataset.step;
    if (step === "phone") return modal({title:"Verify your phone", submit:"Verify", body:`
        <label>Phone number<input name="ph" type="tel" inputmode="tel" placeholder="+233 24 123 4567" autocomplete="tel"></label>
        <label>Code we texted you <span class="hint">Prototype: use 123456</span><input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>`,
      onSubmit: f => { const ph = val(f,"ph").replace(/[^\d+]/g,"");
        if (!/^\+?\d{9,15}$/.test(ph)) return "Enter your full phone number, including the country code.";
        if (val(f,"code") !== "123456") return "That code isn't right. Check the text message and try again.";
        v.checks.phone = true; v.phone = ph.slice(0, ph.length - 4).replace(/\d/g, "•").replace(/^•/, "+") + ph.slice(-4); toast("Phone verified"); }});
    if (step === "id") return modal({title:"Verify your ID", submit:"Send to verification provider", body:`
        <label>Document<select name="doc"><option>Passport</option><option>National ID card (e.g. Ghana Card)</option><option>Driver's licence</option></select></label>
        <label>Photo of the document<input type="file" name="front" accept="image/*"></label>
        <label>Selfie holding the document<input type="file" name="selfie" accept="image/*"></label>
        <p class="hint" style="margin:0">These go directly to our ID-verification provider over an encrypted connection. Pitchside only gets told whether the check passed.</p>`,
      onSubmit: f => { if (!f.elements.front.files.length || !f.elements.selfie.files.length) return "Add both the document photo and the selfie.";
        v.checks.id = true; v.history.push({at:Date.now(), by:"system", text:`ID check passed (${val(f,"doc")})`}); toast("ID check passed"); }});
    if (step === "address") return modal({title:"Proof of address", submit:"Upload", body:`<label>Document <span class="hint">Utility bill or bank letter from the last 3 months</span><input type="file" name="doc" accept="image/*,application/pdf"></label>`,
      onSubmit: f => { if (!f.elements.doc.files.length) return "Choose a file."; v.checks.address = true; toast("Proof of address added"); }});
  },
  verifSubmit(){
    const u = me(), v = u.sellerVerif;
    if (!verifReady(u)) return toast("Finish the required checks first.");
    if (!$("#vAgree") || !$("#vAgree").checked) return toast("Tick the box to accept the marketplace rules.");
    v.status = "pending"; v.appliedAt = Date.now(); v.reason = null; v.history.push({at:Date.now(), by:S.user, text:"Applied for verification"});
    REPORTS.push({id:++reportSeq, queue:"sellers", kind:"sellerVerify", target:{user:S.user}, board:null, reason:"Verification application", by:S.user, at:Date.now(), status:"open"});
    toast("Application sent. You'll be notified when it's reviewed."); render(); },
  sellerApprove(el){ const name = el.dataset.user, v = USERS[name].sellerVerif;
    if (!VCHECKS.filter(c=>c.req).every(c=>v.checks[c.id])) return toast("Required checks aren't complete, so this can't be approved.");
    const prev = v.status; v.status = "verified"; v.decidedAt = Date.now(); v.by = S.user; v.reason = null;
    v.history.push({at:Date.now(), by:S.user, text:"Verified"}); closeSellerQueue(name, "resolved");
    audit("Member verified", name, "Checks complete, record reviewed", prev, "verified");
    notify(name, "market", "You're now verified. The ✓ badge shows on your listings and profile.", "/get-verified");
    toast(`${name} is now verified`); render(); },
  sellerReject(el){ const name = el.dataset.user, v = USERS[name].sellerVerif;
    modal({title:`Don't verify ${name}?`, submit:"Reject application", danger:true, body:`
      <label>Reason <span class="hint">The applicant sees this</span><select name="why">${["Account too new or too few posts","Name doesn't match the ID","Recent marketplace disputes or reports","Suspected duplicate account","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label>
      <label>Note <span class="hint">Optional. What they can do to qualify.</span><textarea name="note" style="min-height:64px"></textarea></label>`,
      onSubmit: f => { const reason = val(f,"note") ? `${val(f,"why")}: ${val(f,"note")}` : val(f,"why");
        const prev = v.status; v.status = "rejected"; v.decidedAt = Date.now(); v.by = S.user; v.reason = reason;
        v.history.push({at:Date.now(), by:S.user, text:"Not approved: " + reason}); closeSellerQueue(name, "dismissed");
        audit("Verification rejected", name, reason, prev, "rejected");
        notify(name, "market", `Your verification wasn't approved: ${reason}`, "/get-verified"); }}); },
  sellerRevoke(el){ const name = el.dataset.user, v = USERS[name].sellerVerif;
    askReason(`Revoke ${name}'s verification`, r => { const prev = v.status; v.status = "revoked"; v.decidedAt = Date.now(); v.by = S.user; v.reason = r;
        v.history.push({at:Date.now(), by:S.user, text:"Verification revoked: " + r});
        audit("Verification revoked", name, r, prev, "revoked");
        notify(name, "market", `Your verification was revoked: ${r}`, "/get-verified"); }, {danger:true, submit:"Revoke"}); },
  verOnly(el){ S.ui.verOnly = el.checked; render(); }
});
Object.assign(GUARD, { sellerApprove: () => "seller.verify", sellerReject: () => "seller.verify", sellerRevoke: () => "seller.verify" });

/* =====================================================================
   PAGE FURNITURE ACTIONS: ad slots, ticker, clean look, avatars, signatures
   ===================================================================== */
const adminOnly = () => { if (!can("manageCategories")) { toast("Only admins can change ad spots."); return false; } return true; };
Object.assign(ACT, {
  railClick(el){ const a = SIDE_ADS.find(x => x.id === +el.dataset.id); if (!a) return; a.clicks++;
    if (!isExt(a.dest)) return go(a.dest);
    const host = a.dest.replace(/^https?:\/\//,"").split("/")[0];
    if (/\.example$/.test(host)) toast(`Sponsored link: would open ${host} in a new tab`); else window.open(a.dest, "_blank", "noopener"); },
  cleanLook(){ if (!adminOnly()) return; LAYOUT.clean = !LAYOUT.clean;
    audit("Advertising change", "clean look", LAYOUT.clean ? "All ad spots hidden" : "Ad spots restored", LAYOUT.clean ? "ads shown" : "clean", LAYOUT.clean ? "clean" : "ads shown");
    toast(LAYOUT.clean ? "Clean look on. All ad spots hidden." : "Clean look off. Ad spots are back."); render(); renderTicker(true); },
  slotToggle(el){ if (!adminOnly()) return; const slot = SIDE_SLOTS.find(x => x.id === el.dataset.id); slot.on = !slot.on;
    audit("Advertising change", slot.label, slot.on ? "Turned on" : "Turned off", slot.on ? "off" : "on", slot.on ? "on" : "off"); render(); },
  sideAdPause(el){ if (!adminOnly()) return; const a = SIDE_ADS.find(x => x.id === +el.dataset.id); a.paused = !a.paused;
    audit("Advertising change", `side ad: ${a.advertiser}`, a.paused ? "Paused" : "Resumed", a.paused ? "live" : "paused", a.paused ? "paused" : "live"); render(); },
  sideAdDel(el){ if (!adminOnly()) return; const a = SIDE_ADS.find(x => x.id === +el.dataset.id);
    modal({title:`Delete the ${a.advertiser} ad?`, submit:"Delete", danger:true, body:`<p style="margin:0">Its stats (${fmt(a.imps)} impressions, ${fmt(a.clicks)} clicks) stay in the audit log.</p>`,
      onSubmit: () => { SIDE_ADS.splice(SIDE_ADS.indexOf(a), 1); audit("Advertising change", `side ad: ${a.advertiser}`, "Deleted", `${a.imps} imps, ${a.clicks} clicks`, "none"); toast("Ad deleted"); }}); },
  sideAdEdit(el){ if (!adminOnly()) return; const a = el.dataset.id ? SIDE_ADS.find(x => x.id === +el.dataset.id) : null; S.ui.railImg = a ? a.img : null;
    const d = t => t ? new Date(t).toISOString().slice(0,10) : "";
    modal({title: a ? `Edit ad: ${a.advertiser}` : "New side ad", submit: a ? "Save" : "Create ad", body:`
      <p class="hint" style="margin:0">160 × 600 skyscraper. Shows beside the page on screens 1600px wide or more.</p>
      <div class="row"><label style="flex:2 1 200px">Advertiser<input name="adv" value="${esc(a?a.advertiser:"")}" required></label>
        <label style="flex:1 1 140px">Slot<select name="slot">${SIDE_SLOTS.map(s=>`<option value="${s.id}" ${(a?a.slot:el.dataset.slot||"right")===s.id?"selected":""}>${esc(s.label)}${s.on?"":" (off)"}</option>`).join("")}</select></label></div>
      <label>Headline <span class="hint">Up to 40 characters</span><input name="h" maxlength="40" value="${esc(a?a.headline:"")}" required></label>
      <label>Text <span class="hint">Up to 100 characters</span><textarea name="t" maxlength="100" style="min-height:60px">${esc(a?a.text:"")}</textarea></label>
      <div class="row"><label style="flex:1 1 140px">Button label<input name="cta" maxlength="20" value="${esc(a?a.cta:"Learn more")}"></label>
        <label style="flex:2 1 220px">Destination <span class="hint">https://… or a path like /forum/tickets</span><input name="dest" value="${esc(a?a.dest:"")}"></label></div>
      <label>Track with affiliate link <span class="hint">Optional. Overrides the destination and counts clicks in Affiliate links.</span><select name="aff"><option value="">No</option>${AFF_LINKS.map(l=>`<option value="${l.id}" ${a&&a.aff===l.id?"selected":""}>${esc(l.name)}${l.status!=="active"?" (paused)":""}</option>`).join("")}</select></label>
      <div class="row"><label style="flex:1">Starts<input type="date" name="start" value="${d(a?a.start:Date.now())}" required></label><label style="flex:1">Ends <span class="hint">Leave empty to run until paused</span><input type="date" name="end" value="${d(a?a.end:Date.now()+30*DAY)}"></label></div>
      <div class="row"><label style="flex:1">Background<input type="color" name="bg" value="${a?a.bg:"#EAF4FC"}" style="height:40px"></label>
        <label style="flex:1">Text<select name="fg"><option value="#0E3A5B" ${!a||a.fg!=="#FFFFFF"?"selected":""}>Dark text</option><option value="#FFFFFF" ${a&&a.fg==="#FFFFFF"?"selected":""}>Light text</option></select></label>
        <label style="flex:1">Button colour<input type="color" name="accent" value="${a?a.accent:"#A9D6F5"}" style="height:40px"></label></div>
      <label>Image <span class="hint">Optional. Square, at least 272 × 272 px, under 2 MB. Shown at 136 × 136 above the headline.</span><input type="file" name="img" accept="image/*" data-change="railImg"></label>
      ${a && a.img ? `<label class="chk"><input type="checkbox" name="noimg"> Remove the current image</label>` : ""}
      <label class="chk"><input type="checkbox" name="gam" ${a&&a.gambling?"checked":""}> Gambling advertiser (adds 18+ notice, hidden from unconfirmed guests)</label>`,
      onSubmit: f => { const h = val(f,"h"), dest = val(f,"dest"), adv = val(f,"adv"), aff = +val(f,"aff") || null;
        if (!adv || !h) return "Add the advertiser and a headline.";
        if (!aff && !isExt(dest) && !dest.startsWith("/")) return "Choose an affiliate link, or give a destination (https://… or a path starting with /).";
        const start = new Date(val(f,"start")).getTime(), end = val(f,"end") ? new Date(val(f,"end")).getTime() + DAY - 1 : null;
        if (!start) return "Pick a start date.";
        if (end && end <= start) return "The end date must be after the start date.";
        const data = {slot:val(f,"slot"), advertiser:adv, headline:h, text:val(f,"t"), cta:val(f,"cta")||"Learn more", dest, aff, start, end, bg:f.elements.bg.value, fg:f.elements.fg.value, accent:f.elements.accent.value,
          gambling:f.elements.gam.checked || !!(aff && affById(aff)?.op), img: f.elements.noimg && f.elements.noimg.checked ? null : (S.ui.railImg || null)};
        if (a) Object.assign(a, data); else SIDE_ADS.push(Object.assign({id:++sideAdSeq, house:false, paused:false, imps:0, clicks:0}, data));
        audit("Advertising change", `side ad: ${adv}`, a ? "Edited" : "Created", a ? "previous" : "none", `${dday(start)} – ${end ? dday(end) : "no end"}`); toast(a ? "Ad saved" : "Ad scheduled"); }}); },
  tickerEdit(el){ if (!adminOnly()) return; const it = el.dataset.id ? TICKER.items.find(x => x.id === +el.dataset.id) : null;
    modal({title: it ? "Edit ticker item" : "Add a ticker item", submit: it ? "Save" : "Add", body:`
      <label>Text <span class="hint">Up to 120 characters. Keep it short: it's read while moving.</span><input name="text" maxlength="120" value="${esc(it?it.text:"")}" required></label>
      <div class="row"><label style="flex:1 1 160px">Type<select name="kind">${[["news","Announcement"],["promo","Promo (shows a New tag)"],["sponsored","Sponsored (shows an Ad tag)"]].map(([k,t])=>`<option value="${k}" ${it&&it.kind===k?"selected":""}>${t}</option>`).join("")}</select></label>
        <label style="flex:2 1 220px">Links to <span class="hint">Optional. https://… or a path like /crypto</span><input name="dest" value="${esc(it?it.dest:"")}"></label></div>
      <div class="row"><label style="flex:1">Show from <span class="hint">Optional</span><input type="date" name="start" value="${it&&it.start?new Date(it.start).toISOString().slice(0,10):""}"></label><label style="flex:1">Until <span class="hint">Optional</span><input type="date" name="end" value="${it&&it.end?new Date(it.end).toISOString().slice(0,10):""}"></label></div>
      <label class="chk"><input type="checkbox" name="gam" ${it&&it.gambling?"checked":""}> Gambling content (hidden from unconfirmed guests)</label>`,
      onSubmit: f => { const text = val(f,"text"), dest = val(f,"dest");
        const tStart = val(f,"start") ? new Date(val(f,"start")).getTime() : null, tEnd = val(f,"end") ? new Date(val(f,"end")).getTime() + DAY - 1 : null;
        if (tStart && tEnd && tEnd <= tStart) return "The end date must be after the start date.";
        if (text.length < 5) return "Write the ticker text.";
        if (dest && !isExt(dest) && !dest.startsWith("/")) return "Links must be a full https:// address or a Pitchside path starting with /.";
        const pr = contentProblem(text); if (pr) return pr;
        const data = {text, dest, start:tStart, end:tEnd, kind:val(f,"kind"), gambling:f.elements.gam.checked || val(f,"kind")==="sponsored" && /bet|casino|odds|stake/i.test(text)};
        if (it) Object.assign(it, data); else TICKER.items.push(Object.assign({id:++tickerSeq, on:true}, data));
        audit("Advertising change", "ticker", it ? "Item edited" : "Item added", it ? "previous" : "none", text.slice(0, 60)); renderTicker(true); toast(it ? "Ticker item saved" : "Added to the ticker"); }}); },
  tickerToggle(el){ if (!adminOnly()) return; const it = TICKER.items.find(x => x.id === +el.dataset.id); it.on = !it.on; renderTicker(true); render(); },
  tickerDel(el){ if (!adminOnly()) return; const i = TICKER.items.findIndex(x => x.id === +el.dataset.id), it = TICKER.items[i];
    TICKER.items.splice(i, 1); audit("Advertising change", "ticker", "Item deleted", it.text.slice(0, 60), "none"); renderTicker(true); render(); toast("Ticker item deleted"); },
  tickerMove(el){ if (!adminOnly()) return; const i = +el.dataset.i, j = i + +el.dataset.d; [TICKER.items[i], TICKER.items[j]] = [TICKER.items[j], TICKER.items[i]]; renderTicker(true); render(); },
  avatarRemove(){ const u = me(); u.avatar = null; toast("Picture removed"); render(); },
  avatarColor(el){ const u = me(); u.avatarColor = el.dataset.c; render(); },
  clearAvatar(el){ const name = el.dataset.user, u = USERS[name];
    askReason(`Remove ${name}'s avatar`, r => { u.avatar = null; u.avatarColor = null; audit("Removed avatar", name, r, "custom", "default"); notify(name, "moderator", `A moderator removed your avatar: ${r}`, "/settings"); toast("Avatar removed"); }, {submit:"Remove", danger:true}); },
  clearSig(el){ const name = el.dataset.user, u = USERS[name];
    askReason(`Clear ${name}'s signature`, r => { const prev = u.sig; u.sig = ""; audit("Cleared signature", name, r, prev.slice(0, 60), "empty"); notify(name, "moderator", `A moderator cleared your signature: ${r}`, "/settings"); toast("Signature cleared"); }, {submit:"Clear", danger:true}); }
});
Object.assign(FORMS, {
  signature(f){ const u = me(), sig = f.elements.sig.value.replace(/\r/g, "").trim();
    if (sig.split("\n").length > 3) return toast("Keep your signature to 3 lines.");
    if (sig.length > 200) return toast("Keep your signature to 200 characters.");
    if (sig && restricted("links") && /https?:\/\/|www\./i.test(sig)) return toast("New members can't put links in a signature yet.");
    if (sig){ const pr = contentProblem(sig); if (pr) return toast(pr); }
    u.sig = sig; u.hideSigs = f.elements.hide.checked; toast(sig ? "Signature saved" : "Signature removed"); render(); }
});
Object.assign(CHANGE, {
  slotRotate(el){ if (!adminOnly()) return; const slot = SIDE_SLOTS.find(x => x.id === el.dataset.id); slot.rotate = el.value; render(); toast("Rotation updated"); },
  slotSecs(el){ if (!adminOnly()) return; const slot = SIDE_SLOTS.find(x => x.id === el.dataset.id); slot.secs = Math.min(60, Math.max(4, +el.value || 10)); el.value = slot.secs; render(); toast(`Rotates every ${slot.secs} seconds`); },
  postAdRotate(el){ if (!adminOnly()) return; LAYOUT.postAdRotate = el.value; render(); toast("Rotation updated"); },
  layoutSet(el){ if (!adminOnly()) return; LAYOUT[el.dataset.k] = el.checked;
    audit("Advertising change", el.dataset.k, el.checked ? "Turned on" : "Turned off", el.checked ? "off" : "on", el.checked ? "on" : "off"); render(); renderTicker(true); },
  tickerSpeed(el){ TICKER.speed = el.value; renderTicker(true); toast(`Ticker speed: ${el.value}`); },
  tickerLabel(el){ TICKER.label = el.value.trim() || "Pitchside Forum"; renderTicker(true); },
  tickerScores(el){ TICKER.scores = el.checked; renderTicker(true); render(); },
  tickerEvery(el){ TICKER.scoresEvery = +el.value; renderTicker(true); },
  railImg(el){ const file = el.files && el.files[0]; if (!file) return; if (file.size > 2e6){ toast("Image must be under 2 MB."); el.value = ""; return; }
    const r = new FileReader(); r.onload = () => { S.ui.railImg = r.result; }; r.readAsDataURL(file); },
  avatarFile(el){ const file = el.files && el.files[0]; if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast("Use a JPG, PNG, WebP or GIF image."); el.value = ""; return; }
    if (file.size > 5e6) { toast("Pictures must be under 5 MB."); el.value = ""; return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {   // crop to a centred square and shrink to 160px so pages stay light
      const side = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 160;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url); me().avatar = c.toDataURL("image/jpeg", 0.85); toast("Avatar updated"); render(); };
    img.onerror = () => { URL.revokeObjectURL(url); toast("That image couldn't be read. Try another file."); };
    img.src = url; }
});
Object.assign(GUARD, { clearAvatar: () => "user.warn", clearSig: () => "user.warn" });
renderTicker(true);

/* =====================================================================
   AFFILIATE + FIRST-POST AD ACTIONS
   ===================================================================== */
S.visitor = S.visitor || "v" + Math.random().toString(36).slice(2, 9);   // anonymous per-visit ID for unique counts
function logAffClick(l, placement){
  AFF_CLICKS.push({link:l.id, placement: AFF_PLACEMENTS[placement] ? placement : "direct", at:Date.now(), visitor:S.user || S.visitor, user:S.user, page:S.path});
}
function leaveTo(url, label){
  const host = url.replace(/^https?:\/\//, "").split(/[/?]/)[0];
  if (/\.example$/.test(host)) return toast(`${label}: click counted. On the live site this opens ${host} in a new tab.`);
  window.open(url, "_blank", "noopener");
}
Object.assign(ACT, {
  affGo(el){ const l = affById(el.dataset.id), p = el.dataset.p || "direct";
    if (!l || l.status !== "active") return toast("This offer isn't available right now.");
    logAffClick(l, p);
    if (el.dataset.ad){ const a = POST_ADS.find(x => x.id === +el.dataset.ad); if (a) a.clicks++; }
    if (el.dataset.slot){ const s = SIDE_ADS.find(x => x.id === +el.dataset.slot); if (s) s.clicks++; }
    leaveTo(l.url.replace(/\{placement\}/g, encodeURIComponent(p)), "Affiliate link"); },
  postAdClick(el){ const a = POST_ADS.find(x => x.id === +el.dataset.id); if (!a) return; a.clicks++;
    if (!isExt(a.dest)) return go(a.dest); leaveTo(a.dest, "Sponsored link"); },
  affDays(el){ S.ui.affDays = +el.dataset.d; render(); },
  affExport(){
    const rows = [["time","link","operator","placement","page","visitor","member"]].concat(AFF_CLICKS.slice().sort((a,b)=>a.at-b.at).map(c => { const l = affById(c.link);
      return [new Date(c.at).toISOString(), l ? l.slug : c.link, l ? l.op : "", c.placement, c.page, c.visitor, c.user || ""]; }));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv"})); a.download = "pitchside-affiliate-clicks.csv";
    document.body.appendChild(a); a.click(); a.remove(); toast(`Exported ${fmt(rows.length - 1)} clicks`); },
  affEdit(el){ if (!adminOnly()) return; const l = el.dataset.id ? affById(el.dataset.id) : null;
    modal({title: l ? `Edit ${l.name}` : "New affiliate link", submit: l ? "Save" : "Create link", body:`
      <label>Name <span class="hint">For your reports, e.g. "Stakeline: sportsbook welcome"</span><input name="name" value="${esc(l?l.name:"")}" required></label>
      <div class="row"><label style="flex:1 1 200px">Operator<select name="op"><option value="">None (not a casino or sportsbook)</option>${OPERATORS.map(o=>`<option value="${o.slug}" ${l&&l.op===o.slug?"selected":""} ${o.blacklist?"disabled":""}>${esc(o.name)}${o.blacklist?" (blacklisted)":""}</option>`).join("")}</select></label>
        <label style="flex:1 1 160px">Short name <span class="hint">Used in /go/…</span><input name="slug" value="${esc(l?l.slug:"")}" pattern="[a-z0-9-]+" required></label></div>
      <label>Partner URL <span class="hint">Your tracking link from the partner. Put {placement} where their sub-ID goes.</span><input name="url" value="${esc(l?l.url:"https://")}" required></label>
      <div class="row"><label style="flex:1 1 180px">Network or programme<input name="network" value="${esc(l?l.network:"")}"></label><label style="flex:1 1 180px">Deal<input name="deal" value="${esc(l?l.deal:"")}" placeholder="e.g. $40 CPA + 25% revenue share"></label></div>
      <label>Offer shown to visitors <span class="hint">Optional. Shown next to the Visit button on the operator page.</span><input name="offer" maxlength="80" value="${esc(l?l.offer:"")}"></label>`,
      onSubmit: f => { const slug = val(f,"slug").toLowerCase(), url = val(f,"url"), o = val(f,"op") ? op(val(f,"op")) : null;
        if (!/^[a-z0-9-]{2,40}$/.test(slug)) return "Short name: lowercase letters, numbers and dashes only.";
        if (AFF_LINKS.some(x => x.slug === slug && x !== l)) return "That short name is already used by another link.";
        if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) return "Partner URL must be a full https:// address.";
        if (o && o.blacklist) return `${o.name} is blacklisted and can't have an affiliate link.`;
        const data = {name:val(f,"name"), op:o ? o.slug : null, slug, url, network:val(f,"network"), deal:val(f,"deal"), offer:val(f,"offer")};
        if (l) Object.assign(l, data); else AFF_LINKS.push(Object.assign({id:++affSeq, status:"active", created:Date.now(), conversions:[]}, data));
        syncAffiliateFlags(); audit("Affiliate link", data.name, l ? "Edited" : "Created", l ? "previous" : "none", "/go/" + slug); toast(l ? "Link saved" : "Affiliate link created"); }}); },
  affToggle(el){ if (!adminOnly()) return; const l = affById(el.dataset.id), o = l.op && op(l.op);
    if (l.status !== "active" && o && o.blacklist) return toast(`${o.name} is blacklisted, so this link stays paused.`);
    l.status = l.status === "active" ? "paused" : "active"; syncAffiliateFlags();
    audit("Affiliate link", l.name, l.status === "active" ? "Resumed" : "Paused", l.status === "active" ? "paused" : "active", l.status); render(); },
  affConv(el){ if (!adminOnly()) return; const l = affById(el.dataset.id);
    modal({title:`Add conversions: ${l.name}`, submit:"Add", body:`<p class="hint" style="margin:0">From the partner's report. Partners that support postbacks send these automatically.</p>
      <div class="row"><label style="flex:1">Sign-ups<input name="su" type="number" min="0" value="0"></label><label style="flex:1">First deposits<input name="fd" type="number" min="0" value="0"></label><label style="flex:1">Commission ($)<input name="amt" type="number" min="0" step="0.01" value="0"></label></div>
      <div class="row"><label style="flex:1">Placement<select name="p">${Object.entries(AFF_PLACEMENTS).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join("")}</select></label><label style="flex:1">Date<input name="d" type="date" value="${new Date().toISOString().slice(0,10)}"></label></div>`,
      onSubmit: f => { const su = +val(f,"su") || 0, fd = +val(f,"fd") || 0, amt = +val(f,"amt") || 0, at = new Date(val(f,"d")).getTime() || Date.now(), p = val(f,"p");
        if (su + fd === 0) return "Enter at least one sign-up or deposit.";
        if (amt < 0) return "Commission can't be negative.";
        for (let i = 0; i < su; i++) l.conversions.push({at, event:"Sign-up", amount:0, placement:p, source:"manual"});
        for (let i = 0; i < fd; i++) l.conversions.push({at, event:"First deposit", amount: fd ? amt / fd : 0, placement:p, source:"manual"});
        if (!fd && amt) l.conversions[l.conversions.length - 1].amount = amt;
        audit("Affiliate conversions", l.name, `${su} sign-ups, ${fd} deposits, ${money(amt)}`, "", "added"); toast("Conversions added"); }}); },
  postAdEdit(el){ if (!adminOnly()) return; const a = el.dataset.id ? POST_ADS.find(x => x.id === +el.dataset.id) : null; S.ui.postAdImg = a ? a.img : null;
    modal({title: a ? `Edit ad: ${a.advertiser}` : "New ad under the first post", submit: a ? "Save" : "Create ad", body:`
      <label>Advertiser<input name="adv" value="${esc(a?a.advertiser:"")}" required></label>
      <label>Headline <span class="hint">Up to 70 characters</span><input name="h" maxlength="70" value="${esc(a?a.headline:"")}" required></label>
      <label>Text <span class="hint">Up to 160 characters</span><textarea name="t" maxlength="160" style="min-height:60px">${esc(a?a.text:"")}</textarea></label>
      <div class="row"><label style="flex:1 1 160px">Button label<input name="cta" maxlength="30" value="${esc(a?a.cta:"Learn more")}"></label>
        <label style="flex:2 1 220px">Track with affiliate link<select name="aff"><option value="">No, use the destination below</option>${AFF_LINKS.map(l=>`<option value="${l.id}" ${a&&a.aff===l.id?"selected":""}>${esc(l.name)}${l.status!=="active"?" (paused)":""}</option>`).join("")}</select></label></div>
      <label>Destination <span class="hint">If not using an affiliate link: https://… or a path like /forum/tickets</span><input name="dest" value="${esc(a?a.dest:"")}"></label>
      <div class="row"><label style="flex:1">Starts<input type="date" name="start" value="${new Date(a?a.start:Date.now()).toISOString().slice(0,10)}" required></label><label style="flex:1">Ends <span class="hint">Leave empty to run until paused</span><input type="date" name="end" value="${a&&a.end?new Date(a.end).toISOString().slice(0,10):new Date(Date.now()+30*DAY).toISOString().slice(0,10)}"></label></div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="lbl">Show in</legend><div class="row" style="gap:12px;flex-wrap:wrap;margin-top:4px">${Object.entries(SECTION_NAMES).map(([k,v])=>`<label class="row" style="gap:6px;font-weight:400;flex-direction:row"><input type="checkbox" name="sec_${k}" ${a&&a.sections.includes(k)?"checked":""}> ${v}</label>`).join("")}</div></fieldset>
      <div class="row"><label style="flex:1">Background<input type="color" name="bg" value="${a?a.bg:"#EAF4FC"}" style="height:40px"></label>
        <label style="flex:1">Text<select name="fg"><option value="#1E2A35" ${!a||a.fg!=="#FFFFFF"?"selected":""}>Dark text</option><option value="#FFFFFF" ${a&&a.fg==="#FFFFFF"?"selected":""}>Light text</option></select></label>
        <label style="flex:1">Button colour<input type="color" name="accent" value="${a?a.accent:"#A9D6F5"}" style="height:40px"></label></div>
      <label>Image <span class="hint">Optional. Square logo or icon, at least 128 × 128 px, under 2 MB. Shown at 64 × 64.</span><input type="file" name="img" accept="image/*" data-change="postAdImg"></label>
      <label class="chk"><input type="checkbox" name="gam" ${a&&a.gambling?"checked":""}> Gambling advertiser (adds 18+ notice, hidden from unconfirmed guests)</label>`,
      onSubmit: f => { const adv = val(f,"adv"), h = val(f,"h"), aff = +val(f,"aff") || null, dest = val(f,"dest");
        if (!adv || !h) return "Add the advertiser and a headline.";
        if (!aff && !isExt(dest) && !dest.startsWith("/")) return "Choose an affiliate link, or give a destination (https://… or a path starting with /).";
        const start = new Date(val(f,"start")).getTime(), end = val(f,"end") ? new Date(val(f,"end")).getTime() + DAY - 1 : null;
        if (!start) return "Pick a start date.";
        if (end && end <= start) return "The end date must be after the start date.";
        const sections = Object.keys(SECTION_NAMES).filter(k => f.elements["sec_"+k].checked);
        if (!sections.length) return "Pick at least one section.";
        const l = aff && affById(aff);
        const data = {advertiser:adv, headline:h, text:val(f,"t"), cta:val(f,"cta")||"Learn more", aff, dest, sections: sections.includes("all") ? ["all"] : sections,
          bg:f.elements.bg.value, fg:f.elements.fg.value, accent:f.elements.accent.value, gambling:f.elements.gam.checked || !!(l && l.op), img:S.ui.postAdImg || null, start, end};
        if (a) Object.assign(a, data); else POST_ADS.unshift(Object.assign({id:++postAdSeq, on:true, house:false, imps:0, clicks:0}, data));
        audit("Advertising change", `first-post ad: ${adv}`, a ? "Edited" : "Created", a ? "previous" : "none", data.sections.join(", ")); toast(a ? "Ad saved" : "Ad created"); }}); },
  postAdToggle(el){ if (!adminOnly()) return; const a = POST_ADS.find(x => x.id === +el.dataset.id); a.on = !a.on;
    audit("Advertising change", `first-post ad: ${a.advertiser}`, a.on ? "Turned on" : "Turned off", a.on ? "off" : "on", a.on ? "on" : "off"); render(); },
  postAdDel(el){ if (!adminOnly()) return; const i = POST_ADS.findIndex(x => x.id === +el.dataset.id), a = POST_ADS[i];
    POST_ADS.splice(i, 1); audit("Advertising change", `first-post ad: ${a.advertiser}`, "Deleted", "on", "none"); toast("Ad deleted"); render(); }
});
Object.assign(CHANGE, {
  postAdImg(el){ const file = el.files && el.files[0]; if (!file) return; if (file.size > 2e6){ toast("Image must be under 2 MB."); el.value = ""; return; }
    const r = new FileReader(); r.onload = () => { S.ui.postAdImg = r.result; }; r.readAsDataURL(file); }
});

/* =====================================================================
   SPORTS ADMIN: sports, leagues, teams, logos
   ===================================================================== */
S.ui.entLogo = {};
function readLogo(file, cb){
  if (!file) return;
  if (!/^image\/(png|svg\+xml|webp|jpeg)$/.test(file.type)) return toast("Use a PNG, SVG, WebP or JPG file.");
  if (file.size > 2e6) return toast("Logos must be under 2 MB.");
  if (file.type === "image/svg+xml"){ const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); return; }
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { const max = 160, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); cb(c.toDataURL("image/png")); };
  img.onerror = () => { URL.revokeObjectURL(url); toast("That image couldn't be read."); };
  img.src = url;
}
Object.assign(CHANGE, {
  entLogo(el){ readLogo(el.files && el.files[0], d => { S.ui.entLogo[el.dataset.k] = d; toast("Logo ready. It's saved when you submit."); }); },
  teamBadges(el){ if (!can("manageCategories")) return; LAYOUT.teamBadges = el.checked; audit("Layout change", "team badges", el.checked ? "Shown" : "Hidden", el.checked ? "hidden" : "shown", el.checked ? "shown" : "hidden"); render(); toast(el.checked ? "Team badges shown" : "Team badges hidden"); },
  admLeague(el){ S.ui.admLeague = el.value; render(); }
});
Object.assign(FORMS, {
  addLeague(f){ const n = val(f,"name"); if (!n) return toast("Name the league.");
    const slug = slugify(n); if (league(slug)) return toast("That league already exists.");
    const l = {slug, name:n, sport:val(f,"sport"), region:val(f,"region"), type:val(f,"type"), country:val(f,"country") || val(f,"region"), season:val(f,"season") || "2026/27", board:null, logo:S.ui.entLogo.league || null};
    LEAGUES.push(l);
    if (f.elements.board.checked) ensureLeagueBoard(l); else l.board = SPORT_BOARD[l.sport] || "general";
    S.ui.entLogo.league = null; audit("Sports entity added", `league ${n}`, `${l.region} · ${sportOf(l.sport).name}`, "none", "created"); toast(`${n} added`); go("/leagues/"+slug); },
  addTeam(f){ const n = val(f,"name"), sh = val(f,"short").toUpperCase(); if (!n || !sh) return toast("Name and short code are required.");
    const slug = slugify(n); if (team(slug)) return toast("That team already exists.");
    const lg = league(val(f,"league")), also = [...f.elements.also.selectedOptions].map(o => o.value).filter(x => x !== lg.slug);
    TEAMS.push({slug, name:n, short:sh, league:lg.slug, also, country:val(f,"country") || lg.country, stadium:val(f,"stadium"), founded:+val(f,"founded") || "", color:f.elements.color.value, logo:S.ui.entLogo.team || null});
    S.ui.entLogo.team = null; audit("Sports entity added", `team ${n}`, lg.name, "none", "created"); toast(`${n} added`); go("/teams/"+slug); },
  addSport(f){ const n = val(f,"name"); if (!n) return; const slug = slugify(n);
    if (SPORTS.some(s => s.slug === slug)) return toast("That sport already exists.");
    SPORTS.push({slug, name:n, launch:true}); audit("Sports entity added", `sport ${n}`, "Admin", "none", "created"); toast(`${n} added. Now add its leagues.`); render(); }
});
Object.assign(ACT, {
  entEdit(el){ const isL = el.dataset.type === "league", x = isL ? league(el.dataset.slug) : team(el.dataset.slug); S.ui.entLogo.edit = null;
    modal({title:`Edit ${x.name}`, submit:"Save", body: (isL ? `
      <label>Name<input name="name" value="${esc(x.name)}" required></label>
      <div class="row"><label style="flex:1">Region<select name="region">${REGIONS.map(r=>`<option ${x.region===r?"selected":""}>${r}</option>`).join("")}</select></label>
        <label style="flex:1">Type<select name="type">${Object.entries(TYPE_LABEL).map(([k,v])=>`<option value="${k}" ${x.type===k?"selected":""}>${v}</option>`).join("")}</select></label>
        <label style="flex:1">Season<input name="season" value="${esc(x.season)}"></label></div>
      <label>Country<input name="country" value="${esc(x.country)}"></label>` : `
      <label>Name<input name="name" value="${esc(x.name)}" required></label>
      <div class="row"><label style="flex:1">Short code<input name="short" maxlength="4" value="${esc(x.short)}" required></label><label style="flex:1">Badge colour<input name="color" type="color" value="${x.color}" style="height:40px"></label></div>
      <label>Main league<select name="league">${LEAGUES.map(l=>`<option value="${l.slug}" ${x.league===l.slug?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label>
      <label>Also plays in<select name="also" multiple size="4">${LEAGUES.filter(l=>l.type==="tournament").map(l=>`<option value="${l.slug}" ${(x.also||[]).includes(l.slug)?"selected":""}>${esc(l.name)}</option>`).join("")}</select></label>
      <div class="row"><label style="flex:1">Ground<input name="stadium" value="${esc(x.stadium||"")}"></label><label style="flex:1">Founded<input name="founded" type="number" value="${x.founded||""}"></label></div>`) + `
      <div class="row" style="align-items:center;gap:12px">${isL ? leagueCrest(x, 48) : crest(x, 48)}<label style="flex:1">Logo<input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" data-change="entLogo" data-k="edit"></label></div>
      ${x.logo ? `<label class="chk"><input type="checkbox" name="nologo"> Remove the uploaded logo</label>` : ""}`,
      onSubmit: f => { const name = val(f,"name"); if (!name) return "Give it a name.";
        if (isL) Object.assign(x, {name, region:val(f,"region"), type:val(f,"type"), season:val(f,"season"), country:val(f,"country") || val(f,"region")});
        else { const sh = val(f,"short").toUpperCase(); if (!sh) return "Add a short code.";
          Object.assign(x, {name, short:sh, color:f.elements.color.value, league:val(f,"league"), also:[...f.elements.also.selectedOptions].map(o=>o.value).filter(v=>v!==val(f,"league")), stadium:val(f,"stadium"), founded:+val(f,"founded")||""}); }
        if (S.ui.entLogo.edit) x.logo = S.ui.entLogo.edit; else if (f.elements.nologo && f.elements.nologo.checked) x.logo = null;
        S.ui.entLogo.edit = null; audit("Sports entity edited", `${isL?"league":"team"} ${name}`, "Admin", "previous", "updated"); toast("Saved"); }}); },
  entDel(el){ const isL = el.dataset.type === "league", x = isL ? league(el.dataset.slug) : team(el.dataset.slug);
    if (isL && TEAMS.some(t => t.league === x.slug)) return toast(`Move or delete ${x.name}'s teams first (${TEAMS.filter(t=>t.league===x.slug).length}).`);
    if (isL && EVENTS.some(e => e.league === x.slug)) return toast(`${x.name} has fixtures, so it can't be deleted.`);
    if (!isL && EVENTS.some(e => e.home === x.slug || e.away === x.slug)) return toast(`${x.name} has fixtures, so it can't be deleted.`);
    modal({title:`Delete ${x.name}?`, submit:"Delete", danger:true, body:`<p style="margin:0">${isL ? "Its discussion board and topics stay in the forum." : "Topics tagged with this team stay in the forum."}</p>`,
      onSubmit: () => { if (isL){ LEAGUES.splice(LEAGUES.indexOf(x), 1); TEAMS.forEach(t => t.also = (t.also||[]).filter(a => a !== x.slug)); }
        else TEAMS.splice(TEAMS.indexOf(x), 1);
        audit("Sports entity deleted", `${isL?"league":"team"} ${x.name}`, "Admin", "existed", "deleted"); toast(`${x.name} deleted`); }}); }
});

/* =====================================================================
   LIVE SITE: connects the app to the Pitchside server (PHP + MySQL).
   Only included in the production build. The server is the source of truth:
   every change goes through /api/op, which checks permissions again and
   answers with everything that changed since this browser's last sync.
   ===================================================================== */
const PS = {since:0, csrf:null, docVers:{}, docSnap:{}, impBase:{}, clickAdd:{}, viewed:{}, convRead:{}, loading:{}, missing:{}, searched:null, firstApply:true, pushing:false};
const LIVE_DOCS = ["CATEGORIES","BOARDS","TAGS","NAV","SEO","SETTINGS","LAYOUT","BANNERS","SIDE_SLOTS","SIDE_ADS","TICKER","POST_ADS","AFF_LINKS",
  "SPORTS","LEAGUES","TEAMS","SPORT_BOARD","PERMS","LIMITS","RANKS","MOD_TEMPLATES","MOD_PROFILES","EVENTS"];
const PUSHABLE = LIVE_DOCS.filter(k => k !== "EVENTS");
const AD_KIND = {BANNERS:"banner", SIDE_ADS:"side", POST_ADS:"post"};

/* ---------- Settings documents: read, replace, compare ---------- */
function docGet(k){ return ({CATEGORIES, BOARDS, TAGS, NAV, SEO, SETTINGS, LAYOUT, BANNERS, SIDE_SLOTS, SIDE_ADS, TICKER, POST_ADS, AFF_LINKS,
  SPORTS, LEAGUES, TEAMS, SPORT_BOARD, PERMS, LIMITS, RANKS, MOD_TEMPLATES, MOD_PROFILES, EVENTS})[k]; }
function replaceObj(target, src){ Object.keys(target).forEach(x => delete target[x]); Object.assign(target, src); }
function docSet(k, v){
  switch (k){
    case "CATEGORIES": CATEGORIES = v; break; case "BOARDS": BOARDS = v; break; case "TAGS": TAGS = v; break; case "NAV": NAV = v; break;
    case "SEO": SEO = v; break; case "SETTINGS": SETTINGS = v; break; case "LAYOUT": LAYOUT = v; break; case "BANNERS": BANNERS = v; break;
    case "SIDE_SLOTS": SIDE_SLOTS = v; break; case "SIDE_ADS": SIDE_ADS = v; break; case "TICKER": TICKER = v; break; case "POST_ADS": POST_ADS = v; break;
    case "AFF_LINKS": AFF_LINKS = v; break; case "SPORTS": SPORTS = v; break; case "LEAGUES": LEAGUES = v; break; case "TEAMS": TEAMS = v; break;
    case "RANKS": RANKS = v; break; case "MOD_TEMPLATES": MOD_TEMPLATES = v; break; case "MOD_PROFILES": MOD_PROFILES = Array.isArray(v) ? {} : v; break;
    case "EVENTS": EVENTS = v; break;
    case "SPORT_BOARD": replaceObj(SPORT_BOARD, Array.isArray(v) ? {} : v); break;
    case "PERMS": replaceObj(PERMS, v); break; case "LIMITS": replaceObj(LIMITS, v); break;
  }
}
const revive = (k, v) => v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.$set) && Object.keys(v).length === 1 ? new Set(v.$set) : v;
const docSer = v => JSON.stringify(v, (k, x) => x instanceof Set ? {$set:[...x]} : (k === "imps" || k === "clicks") ? undefined : x);
const fromServer = v => JSON.parse(JSON.stringify(v), revive);

/* ---------- Applying what the server sends ---------- */
function liveUser(u){ return Object.assign({sellerVerif: blankVerif(), wallets:{}, rep:{forum:0,market:0,review:0,prediction:null}, badges:[], favTeams:[], favSports:[]}, u); }
function liveTopic(t){ t.posts.forEach(p => { p.likes = new Set(p.likes); p.revisions = p.revisions || []; });
  if (t.poll) t.poll.options.forEach(o => o.v = new Set(o.v)); t.tags = t.tags || []; t.teams = t.teams || []; return t; }
function upsertBy(list, items, key="id"){ items.forEach(x => { const i = list.findIndex(y => y[key] === x[key]); if (i > -1) list[i] = x; else list.push(x); }); }

function apply(d){
  if (!d) return false;
  let changed = false;
  if (d.full){
    TOPICS = []; CONVS = []; NOTIFS = []; REPORTS = []; AUDIT = []; FOLLOWS = {}; BOOKMARKS = {}; READS = {}; BLOCKS = {}; AFF_CLICKS = [];
    Object.keys(PREDICTIONS).forEach(k => delete PREDICTIONS[k]);
    if (PS.firstApply){ Object.keys(USERS).forEach(k => delete USERS[k]);
      // Casino directory, complaints, marketplace listings and escrow open in later phases
      OPERATORS = []; REVIEWS = []; COMPLAINTS = []; LISTINGS = []; ESCROWS = []; PS.firstApply = false; }
    changed = true;
  }
  Object.entries(d.users || {}).forEach(([n, u]) => { USERS[n] = liveUser(u); });
  Object.entries(d.docs || {}).forEach(([k, v]) => { const val = fromServer(v); docSet(k, val); PS.docSnap[k] = docSer(val); changed = true;
    if (AD_KIND[k]) val.forEach(a => PS.impBase[AD_KIND[k] + ":" + a.id] = a.imps || 0); });
  Object.assign(PS.docVers, d.docVers || {});
  if (d.docs && (d.docs.LEAGUES || d.docs.BOARDS)) LEAGUES.forEach(l => { if (!l.board) ensureLeagueBoard(l); });
  if (d.topics && d.topics.length){ upsertBy(TOPICS, d.topics.map(liveTopic)); changed = true; }
  if (d.gone && d.gone.length){ TOPICS = TOPICS.filter(t => !d.gone.includes(t.id)); changed = true; }
  TOPICS.sort((a, b) => b.id - a.id);
  if (d.convs && d.convs.length){ upsertBy(CONVS, d.convs); changed = true; }
  if (d.notifs && d.notifs.length){ upsertBy(NOTIFS, d.notifs); NOTIFS.sort((a, b) => a.at - b.at); changed = true; }
  if (d.reports && d.reports.length){ upsertBy(REPORTS, d.reports); changed = true; }
  if (d.audit && d.audit.length){ upsertBy(AUDIT, d.audit); AUDIT.sort((a, b) => b.at - a.at); changed = true; }
  if (d.affClicks && d.affClicks.length) AFF_CLICKS = d.full ? d.affClicks : AFF_CLICKS.concat(d.affClicks);
  Object.entries(d.predictions || {}).forEach(([ev, m]) => { PREDICTIONS[ev] = Object.assign(PREDICTIONS[ev] || {}, m); });
  if (d.me){
    FOLLOWS[d.me] = new Set(d.follows || []); BOOKMARKS[d.me] = new Set(d.bookmarks || []); READS[d.me] = Object.assign({}, d.reads || {});
    if (d.blocks){ BLOCKS[d.me] = new Set(d.blocks.mine); d.blocks.by.forEach(b => { (BLOCKS[b] = BLOCKS[b] || new Set()).add(d.me); }); }
  }
  // Moderators can read a reported private message without joining the conversation
  (d.reportedMsgs || []).forEach(m => { let c = CONVS.find(x => x.id === m.conv);
    if (!c){ c = {id:m.conv, members:[], title:"Reported message", msgs:[], read:{}, reportOnly:true}; CONVS.push(c); }
    if (!c.msgs.some(x => x.id === m.id)) c.msgs.push({id:m.id, from:m.from, body:m.body, at:m.at, att:[]}); });
  if (d.stats) STATS = d.stats;
  if (d.site) PS.site = d.site;
  PS.since = d.now; if (d.csrf) PS.csrf = d.csrf;
  const prevUser = S.user;
  S.user = d.me && USERS[d.me] ? d.me : null; S.role = S.user ? USERS[S.user].role : "guest";
  if (S.user) S.ageOk = true;
  if (prevUser !== S.user) changed = true;
  bannerSeq = Math.max(0, ...BANNERS.map(x => x.id)); sideAdSeq = Math.max(0, ...SIDE_ADS.map(x => x.id)); postAdSeq = Math.max(0, ...POST_ADS.map(x => x.id));
  tickerSeq = Math.max(0, ...TICKER.items.map(x => x.id)); affSeq = Math.max(0, ...AFF_LINKS.map(x => x.id));
  if (d.pending2fa) setTimeout(ask2fa, 0);
  return changed;
}

/* ---------- Talking to the server ---------- */
async function api(op, args={}, opts={}){
  let r, d;
  try {
    r = await fetch("/api/op", {method:"POST", credentials:"same-origin", keepalive: !!opts.keepalive,
      headers:{"Content-Type":"application/json", "X-Requested-With":"pitchside", "X-CSRF": PS.csrf || ""},
      body: JSON.stringify(Object.assign({op, _since: PS.since}, args))});
    d = await r.json();
  } catch(e){ throw new Error("Couldn't reach Pitchside. Check your connection and try again."); }
  if (!r.ok || !d.ok){
    const err = new Error(d && d.error || "Something went wrong. Try again."); err.status = r.status;
    if (r.status === 409 || r.status === 419) await resync(true);
    if (r.status === 401 && S.user) await resync(true);
    throw err;
  }
  if (d.sync) apply(d.sync);
  return d.result || {};
}
// Runs a server call from a button: shows the error as a toast, re-renders on success.
function act(op, args, okMsg, then){ return api(op, args).then(res => { if (okMsg) toast(typeof okMsg === "function" ? okMsg(res) : okMsg); if (then) then(res); else render(); return res; })
  .catch(e => { toast(e.message); }); }
// For modal forms: resolve to an error message (shown in the dialog) or nothing (dialog closes).
const viaApi = (op, args, after) => api(op, args).then(res => { if (after) return after(res); }).catch(e => e.message);

async function resync(full){
  try {
    const r = await fetch("/api/sync?since=" + (full ? 0 : PS.since), {credentials:"same-origin", headers:{"X-Requested-With":"pitchside"}});
    if (!r.ok) return false;
    return apply(await r.json());
  } catch(e){ return false; }
}
// Background refresh: new replies, messages and notifications arrive without reloading.
function quietRender(){
  const ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && $("#view").contains(ae);
  const dirty = $$("#view textarea").some(t => t.value.trim() && t.id !== "msgBody");
  if ($("#modal").open || typing || dirty) renderShell(); else render();
}
setInterval(async () => { if (document.hidden) return; if (await resync(false)) quietRender(); }, 25000);
document.addEventListener("visibilitychange", async () => { if (!document.hidden && await resync(false)) quietRender(); });

/* ---------- Admin changes: settings documents are saved as soon as they change ---------- */
const canPushDocs = () => S.user && (can("manageCategories") || can("managePermissions"));
let pushTimer = null;
function schedulePush(){ if (!canPushDocs()) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushDocs, 350); }
async function pushDocs(){
  if (PS.pushing || !canPushDocs()) return; PS.pushing = true;
  try {
    for (const k of PUSHABLE){
      const cur = docSer(docGet(k)); if (cur === PS.docSnap[k]) continue;
      const need = ["PERMS","LIMITS","MOD_TEMPLATES","MOD_PROFILES"].includes(k) ? "managePermissions" : "manageCategories";
      if (!can(need)){ await resync(true); render(); toast("You don't have permission to change that."); break; }
      try { await api("config.save", {k, v: JSON.parse(cur), ver: PS.docVers[k]}); PS.docSnap[k] = docSer(docGet(k)); }
      catch(e){ toast(e.message); await resync(true); render(); renderTicker(true); break; }
    }
  } finally { PS.pushing = false; }
}
document.addEventListener("click", schedulePush); document.addEventListener("change", schedulePush); document.addEventListener("submit", schedulePush);

/* ---------- Ad impressions and clicks, sent in small batches ---------- */
function flushAds(keepalive=false){
  const body = {_nosync:true}; let any = false;
  Object.entries(AD_KIND).forEach(([k, kind]) => { docGet(k).forEach(a => { const key = kind + ":" + a.id, base = PS.impBase[key] || 0, n = (a.imps || 0) - base;
    if (n > 0){ (body[kind] = body[kind] || {})[a.id] = Math.min(50, n); PS.impBase[key] = a.imps; any = true; } }); });
  const clicks = PS.clickAdd; PS.clickAdd = {};
  Object.entries(clicks).forEach(([key, n]) => { const [kind, id] = key.split(":"); api("ad.click", {kind, id:+id, _nosync:true}, {keepalive:true}).catch(() => {}); });
  if (any) api("ad.imps", body, {keepalive}).catch(() => {});
}
setInterval(() => flushAds(), 20000);
addEventListener("pagehide", () => flushAds(true));
function countClick(kind, id){ PS.clickAdd[kind + ":" + id] = (PS.clickAdd[kind + ":" + id] || 0) + 1; flushAds(); }
const openOut = url => window.open(url, "_blank", "noopener");

/* ---------- Pages that load on demand, and later-phase sections ---------- */
function loadTopic(id){
  if (PS.loading["t" + id]) return; PS.loading["t" + id] = true;
  fetch("/api/topic/" + id, {credentials:"same-origin"}).then(r => r.json()).then(d => {
    if (d.topic){ Object.entries(d.users || {}).forEach(([n, u]) => USERS[n] = liveUser(u)); upsertBy(TOPICS, [liveTopic(d.topic)]); } else PS.missing["t" + id] = true;
  }).catch(() => { PS.missing["t" + id] = true; }).finally(() => { PS.loading["t" + id] = false; render(); });
}
function loadUser(name){
  if (PS.loading["u" + name]) return; PS.loading["u" + name] = true;
  fetch("/api/user/" + encodeURIComponent(name), {credentials:"same-origin"}).then(r => r.json()).then(d => {
    if (d.user){ USERS[name] = liveUser(d.user); upsertBy(TOPICS, (d.topics || []).map(liveTopic)); } else PS.missing["u" + name] = true;
  }).catch(() => { PS.missing["u" + name] = true; }).finally(() => { PS.loading["u" + name] = false; render(); });
}
const vLoading = () => `<section class="panel" style="text-align:center;padding:40px" aria-busy="true"><p class="muted" style="margin:0">Loading…</p></section>`;
function vSoon(title, text){
  return crumbs([title]) + phead(esc(title)) + `<section class="panel" style="max-width:70ch"><h2 class="sec" style="margin-top:0">Opening soon</h2>
    <p>${esc(text)}</p><p style="margin-bottom:0">${link("/gambling", "Gambling discussion", "btn")} ${link("/community", "Community", "btn ghost")}</p></section>`;
}
const SOON = {
  casinos:["casinos", "Casinos & sportsbooks", "The ranked list of casinos and sportsbooks, with member ratings and the Safety Index, opens in the next phase. Until then, share your experiences in the Gambling discussion boards."],
  sportsbooks:["casinos", "Casinos & sportsbooks", "The ranked list of casinos and sportsbooks opens in the next phase."],
  reviews:["casinos", "Reviews", "Casino and sportsbook reviews open with the casino directory in the next phase."],
  complaints:["complaints", "Complaints", "Our complaint service, where specialists mediate between players and operators, opens in the next phase."],
  blacklist:["casinos", "Blacklisted casinos", "The blacklist opens with the casino directory in the next phase."],
  marketplace:["marketplace", "Marketplace", "The member marketplace opens soon, with listing approval and optional seller verification."],
  escrow:["escrow", "Escrow", "Stablecoin escrow for marketplace deals opens after an independent security audit."],
  "get-verified":["verification", "Get verified", "Seller verification opens with the marketplace."]
};
function liveGate(seg, qs){
  const s0 = seg[0] || "";
  if (SOON[s0] && !featureOn(SOON[s0][0])) return vSoon(SOON[s0][1], SOON[s0][2]);
  if (s0 === "topic" && seg[1] && !topic(seg[1])){
    if (PS.missing["t" + seg[1]]) return vMissing("That topic doesn't exist, or you can't see it.");
    loadTopic(+seg[1]); return vLoading(); }
  if (s0 === "members" && seg[1] && !USERS[seg[1]]){
    if (PS.missing["u" + seg[1]]) return vMissing("There's no member with that name.");
    loadUser(seg[1]); return vLoading(); }
  if (s0 === "reset") return vReset(qs.token || "");
  if (s0 === "verify") return vVerify(qs.token || "");
  if (s0 === "search" && (qs.q || "").trim().length >= 2 && PS.searched !== qs.q){ PS.searched = qs.q; liveSearch(qs.q); }
  return null;
}
function liveSearch(q){
  const f = S.ui.sf || {};
  api("search", {q, author:f.author || "", board:f.board || "all"}).then(res => {
    Object.entries(res.users || {}).forEach(([n, u]) => USERS[n] = liveUser(u)); upsertBy(TOPICS, (res.topics || []).map(liveTopic)); render();
  }).catch(() => {});
}

/* ---------- After every render: views, read markers, account notices ---------- */
const origRender = render;
render = function(){
  origRender();
  const {seg} = parse(S.path);
  if (seg[0] === "topic" && seg[1]){ const t = topic(seg[1]);
    if (t){ const n = t.posts.length, key = t.id + ":" + n;
      if (!PS.viewed[key]){ PS.viewed[key] = true; if (S.user) (READS[S.user] = READS[S.user] || {})[t.id] = n; api("topic.view", {id:t.id, n, _nosync:true}).catch(() => {}); } } }
  if (seg[0] === "messages" && seg[1] && S.user){ const c = CONVS.find(x => x.id === +seg[1]);
    if (c && !c.reportOnly && PS.convRead[c.id] !== c.msgs.length){ PS.convRead[c.id] = c.msgs.length; api("conv.read", {conv:c.id, _nosync:true}).catch(() => {}); } }
  const u = me();
  if (u && u.needsVerify && !$("#verifyNote")){
    $("#view").insertAdjacentHTML("afterbegin", `<div class="notice amber" id="verifyNote" style="margin-bottom:16px"><strong>Confirm your email.</strong><span>We sent a link to ${esc(u.email || "your inbox")}. You can read everything now; posting and messaging members unlock once you confirm.</span><button class="btn small" type="button" data-act="resendVerify">Send it again</button></div>`); }
};
addEventListener("popstate", () => { S.path = location.pathname + location.search; render(); });

/* ---------- Sign in, join, password reset, email confirmation, two-factor ---------- */
function turnstileBox(){ return PS.site && PS.site.turnstile ? `<div id="tsBox" style="min-height:65px"></div>` : ""; }
function mountTurnstile(){
  if (!(PS.site && PS.site.turnstile)) return;
  const draw = () => { const box = $("#tsBox"); if (box && window.turnstile) window.turnstile.render(box, {sitekey: PS.site.turnstile}); };
  if (window.turnstile) return draw();
  const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = draw; document.head.appendChild(s);
}
function ask2fa(){
  if ($("#modal").open) return;
  modal({title:"Two-factor code", submit:"Verify", body:`<p class="muted" style="margin:0">Enter the 6-digit code from your authenticator app.</p><label>Code<input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>`,
    onSubmit: f => viaApi("auth.2fa", {code: val(f,"c")}, () => { toast("Signed in as " + S.user); go(S.path); }),
    cancel:"Cancel"});
}
Object.assign(ACT, {
  signIn(el, why){ if (typeof why !== "string") why = ""; modal({title:"Sign in", submit:"Sign in", body:`${why ? `<p class="muted" style="margin:0">${esc(why)}</p>` : ""}
      <label>Username or email<input name="u" autocomplete="username" required></label><label>Password<input name="p" type="password" autocomplete="current-password" required></label>
      <p style="margin:0;font-size:.9rem"><a href="#" data-act="resetPw">Forgot password?</a> · <a href="#" data-act="register">Join free</a></p>`,
      onSubmit: f => viaApi("auth.login", {u: val(f,"u"), p: f.elements.p.value}, res => {
        if (res.need2fa){ setTimeout(ask2fa, 50); return; }
        toast(res.restored ? `Welcome back, ${res.name}. Your account deletion was cancelled.` : "Signed in as " + res.name); }) }); },
  register(){ modal({title:"Join Pitchside Forum", submit:"Create account", body:`<label>Username<input name="u" required maxlength="24" autocomplete="username"><span class="hint">3 to 24 letters, numbers or underscores. This is public.</span></label>
      <label>Email<input name="e" type="email" required autocomplete="email"><span class="hint">Never shown to other members.</span></label>
      <label>Password<input name="p" type="password" required minlength="8" autocomplete="new-password"><span class="hint">At least 8 characters.</span></label>
      <label class="chk"><input type="checkbox" name="age"> I'm 18 or older, or I'll stay out of the gambling sections</label>
      <label class="chk"><input type="checkbox" name="tos"> I accept the ${link("/page/terms","Terms")} and ${link("/page/rules","Rules")}</label>${turnstileBox()}`,
      onSubmit: f => { if (!f.elements.tos.checked) return "Accept the Terms to continue.";
        const ts = window.turnstile && $("#tsBox") ? window.turnstile.getResponse() : "";
        return viaApi("auth.register", {u: val(f,"u"), e: val(f,"e"), p: f.elements.p.value, age: f.elements.age.checked, tos: true, ts}, res => {
          toast(res.verify ? `Welcome, ${res.name}! Check your email to confirm your address.` : `Welcome, ${res.name}!`); })
          .then(err => { if (err && window.turnstile) try { window.turnstile.reset(); } catch(e){} return err; }); } });
    mountTurnstile(); },
  resetPw(){ modal({title:"Reset password", submit:"Send reset link", body:`<label>Email<input name="e" type="email" required autocomplete="email"></label><p class="hint" style="margin:0">We'll email a link to choose a new password.</p>`,
      onSubmit: f => viaApi("auth.resetRequest", {e: val(f,"e")}, () => { toast("If that email has an account, a reset link is on its way."); }) }); },
  resendVerify(){ act("auth.resendVerify", {}, "Sent. Check your inbox (and the spam folder)."); },
  signOut(){ api("auth.logout").then(() => { toast("Signed out"); go("/"); }).catch(e => toast(e.message)); },
  twoFA(){ const u = me();
    if (u.twoFA) return modal({title:"Turn off two-factor", submit:"Turn off", danger:true, body:`<label>Your password<input name="p" type="password" autocomplete="current-password" required></label>`,
      onSubmit: f => viaApi("auth.totpDisable", {p: f.elements.p.value}, () => { toast("Two-factor is off"); }) });
    api("auth.totpSetup").then(res => {
      modal({title:"Turn on two-factor", submit:"Verify", body:`<p style="margin:0">In your authenticator app (Google Authenticator, Authy, 1Password…), add an account with this key, then enter the 6-digit code it shows.</p>
        <div class="mono" style="padding:14px;background:var(--sunk);text-align:center;border-radius:6px;font-size:1.05rem;letter-spacing:.08em;overflow-wrap:anywhere">${esc(res.secret.replace(/(.{4})/g, "$1 ").trim())}</div>
        <p class="hint" style="margin:0">On your phone? <a href="${esc(res.uri)}">Open in your authenticator app</a>.</p>
        <label>Code<input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>`,
        onSubmit: f => viaApi("auth.totpEnable", {code: val(f,"c")}, () => { toast("Two-factor is on. Other devices were signed out."); }) });
    }).catch(e => toast(e.message)); },
  changePw(){ modal({title:"Change password", submit:"Change password", body:`<label>Current password<input name="o" type="password" autocomplete="current-password" required></label><label>New password<input name="p" type="password" autocomplete="new-password" minlength="8" required></label>`,
      onSubmit: f => viaApi("auth.changePassword", {old: f.elements.o.value, p: f.elements.p.value}, () => { toast("Password changed. Other devices were signed out."); }) }); },
  changeEmail(){ modal({title:"Change email", submit:"Save", body:`<label>New email<input name="e" type="email" required autocomplete="email"></label><label>Your password<input name="p" type="password" autocomplete="current-password" required></label>`,
      onSubmit: f => viaApi("auth.changeEmail", {e: val(f,"e"), p: f.elements.p.value}, res => { toast(res.verify ? "Saved. Confirm the new address from your inbox." : "Email changed."); }) }); },
  showSessions(){ api("auth.sessions").then(res => modal({title:"Where you're signed in", submit:null, cancel:"Close", body:`<div class="stack" style="gap:8px">${res.sessions.map(s => `<div class="panel" style="padding:10px 12px"><div style="font-size:.9rem;overflow-wrap:anywhere">${esc(s.ua || "Unknown browser")}</div><div class="meta">${esc(s.ip)} · last active ${rel(s.lastSeen)}${s.current ? ' · <strong>this device</strong>' : ""}</div></div>`).join("")}</div>`})).catch(e => toast(e.message)); },
  logoutAll(){ act("auth.logoutAll", {}, res => `Signed out of ${res.ended} other device${res.ended === 1 ? "" : "s"}.`); },
  exportData(){ location.href = "/api/export"; toast("Your download is starting."); },
  deleteAccount(){ modal({title:"Delete your account?", submit:"Delete account", danger:true, body:`<p style="margin:0">Your profile is removed after a 30-day grace period. Sign in within 30 days to cancel. Posts stay but show as “deleted user”.</p><label>Type your username<input name="u" required></label><label>Your password<input name="p" type="password" autocomplete="current-password" required></label>`,
      onSubmit: f => viaApi("account.delete", {u: val(f,"u"), p: f.elements.p.value}, () => { toast("Deletion scheduled. Sign in within 30 days to cancel."); go("/"); }) }); }
});
function vReset(token){
  return crumbs(["Reset password"]) + phead("Choose a new password") + `<form class="panel form" style="max-width:420px" data-form="resetPw" data-token="${esc(token)}">
    <label>New password<input name="p" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn primary" type="submit">Save password</button></form>`;
}
FORMS.resetPw = f => api("auth.resetConfirm", {token: f.dataset.token, p: f.elements.p.value}).then(res => {
  if (res.need2fa) return ask2fa(); toast("Password changed. You're signed in."); go("/"); }).catch(e => toast(e.message));
function vVerify(token){
  if (!PS.verifying){ PS.verifying = true;
    api("auth.verify", {token}).then(() => { toast("Email confirmed. Thanks!"); go("/"); }).catch(e => { PS.verifyErr = e.message; render(); }); }
  return crumbs(["Confirm email"]) + phead("Confirming your email") + `<section class="panel" style="max-width:520px">${PS.verifyErr ? `<p style="margin:0">${esc(PS.verifyErr)}</p>` : `<p class="muted" style="margin:0">One moment…</p>`}</section>`;
}
function liveSecurity(u){
  return `<section class="panel"><h3 class="ph">Security</h3>
    <div class="spread" style="padding:4px 0"><span>Two-factor authentication</span><button class="btn small${u.twoFA?" on":""}" type="button" data-act="twoFA">${u.twoFA?"On":"Turn on"}</button></div>
    <div class="spread" style="padding:4px 0"><span>Password</span><button class="btn small" type="button" data-act="changePw">Change</button></div>
    <div class="spread" style="padding:4px 0"><span>Email <span class="muted">${esc(u.email || "")}</span></span><button class="btn small" type="button" data-act="changeEmail">Change</button></div>
    <div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="showSessions">Where I'm signed in</button><button class="btn small" type="button" data-act="logoutAll">Sign out other devices</button></div></section>`;
}
function aOverviewLive(){
  const imps = [...BANNERS, ...SIDE_ADS, ...POST_ADS].reduce((n, a) => n + (a.imps || 0), 0), clicks = [...BANNERS, ...SIDE_ADS, ...POST_ADS].reduce((n, a) => n + (a.clicks || 0), 0);
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px">
    ${tile("Members", fmt(STATS.members||0), `${fmt(STATS.newUsers7||0)} joined in the last 7 days`)}${tile("Active today / this month", `${fmt(STATS.dau||0)} / ${fmt(STATS.mau||0)}`, "signed-in members")}
    ${tile("Online now", fmt(STATS.online||0), "last 15 minutes")}${tile("Posts today", fmt(STATS.postsToday||0), `${fmt(STATS.topicsToday||0)} new topics`)}
    ${tile("All topics / posts", `${fmt(STATS.totalTopics||0)} / ${fmt(STATS.totalPosts||0)}`, `${fmt(STATS.posters7||0)} people posted this week`)}${tile("Open reports", openReports().length, "moderation workload")}
    ${tile("Ad impressions", fmt(imps), `${fmt(clicks)} clicks`)}${tile("Affiliate clicks", fmt(AFF_CLICKS.filter(c => c.at > Date.now() - 30*DAY).length), "last 30 days")}</div>
    ${STATS.mailReady ? "" : `<div class="notice amber"><strong>Email isn't set up yet.</strong><span>Sign-up confirmations, password resets and email notifications need SMTP settings in the server's config.php. Until then, new accounts are confirmed automatically and emails are written to app/storage/mail.log.</span></div>`}`;
}

/* ---------- Forum ---------- */
const ORIG = Object.assign({}, ACT);
// Opens the prototype's dialog (same fields and wording), then swaps in a submit handler that saves through the server.
function withModal(fn, submit){ return function(el){ const before = modalSubmit; fn.call(ACT, el); if ($("#modal").open && modalSubmit !== before) modalSubmit = f => submit(f, el); }; }
const pollArgs = f => ({q: val(f,"pq"), options: val(f,"po").split("\n").map(s => s.trim()).filter(Boolean), multi: f.elements.pm.checked, publicResults: f.elements.pp.checked, days: +val(f,"pd") || 3});
Object.assign(ACT, {
  newTopic: withModal(ORIG.newTopic, f => {
    const title = val(f,"title"); if (title.length < 8) return "Give the topic a title of at least 8 characters.";
    return viaApi("topic.create", {board: val(f,"board"), title, body: val(f,"body"), team: val(f,"team"), tags: TAGS.filter(t => f.elements["tag_"+t.slug] && f.elements["tag_"+t.slug].checked).map(t => t.slug),
      poll: val(f,"pq") ? pollArgs(f) : null}, res => { nav("/topic/" + res.id); toast("Topic posted"); }); }),
  addPoll: withModal(ORIG.addPoll, (f, el) => viaApi("poll.add", Object.assign({id: +el.dataset.id}, pollArgs(f)))),
  editPost: withModal(ORIG.editPost, (f, el) => viaApi("post.edit", {topic: +el.dataset.topic, post: +el.dataset.post, body: val(f,"body")})),
  hidePost: withModal(ORIG.hidePost, (f, el) => { const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("post.hide", {topic: +el.dataset.topic, post: +el.dataset.post, reason: r}); }),
  split: withModal(ORIG.split, (f, el) => { const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("topic.split", {topic: +el.dataset.topic, post: +el.dataset.post, title: val(f,"title"), reason: r}, res => nav("/topic/" + res.id)); }),
  modTopic: withModal(ORIG.modTopic, (f, el) => { const opn = el.dataset.op, id = +el.dataset.id;
    if (opn === "tags") return viaApi("topic.mod", {id, do:"tags", tags: TAGS.filter(t => f.elements["tag_"+t.slug] && f.elements["tag_"+t.slug].checked).map(t => t.slug)});
    const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("topic.mod", {id, do: opn, reason: r, to: f.elements.to ? f.elements.to.value : null}, res => {
      if (opn === "merge") nav("/topic/" + res.into); if (opn === "delete"){ const t = topic(id); nav("/forum/" + (t ? t.board : "")); } }); }),
  like(el){ if (!signedIn()) return needSignIn("Sign in to like posts."); act("post.like", {topic: +el.dataset.topic, post: +el.dataset.post}); },
  follow(el){ if (!signedIn()) return needSignIn("Sign in to follow."); act("follow.toggle", {key: el.dataset.key}, res => res.on ? "Following. You'll get notifications." : "Unfollowed"); },
  bookmark(el){ if (!signedIn()) return needSignIn("Sign in to bookmark."); act("bookmark.toggle", {id: +el.dataset.id}, res => res.on ? "Bookmarked" : "Bookmark removed"); },
  predict(el){ if (!signedIn()) return needSignIn("Sign in to predict."); act("predict", {slug: el.dataset.slug, v: el.dataset.v}, "Prediction saved"); },
  createMatchThread(el){ api("matchThread.create", {slug: el.dataset.slug}).then(res => { nav("/topic/" + res.id); render(); }).catch(e => toast(e.message)); },
  ageOk(){ S.ageOk = true; try { localStorage.setItem("ps_age", "1"); } catch(e){} render(); },
  readAll(){ act("notif.readAll", {}); },
  openNotif(el){ const n = NOTIFS.find(x => x.id === +el.dataset.id); if (n) n.read = true; api("notif.read", {id: +el.dataset.id}).catch(() => {}); go(n ? n.go : "/notifications"); },
  appeal: withModal(ORIG.appeal, f => { if (val(f,"t").length < 10) return "Explain in a sentence or two."; return viaApi("appeal.create", {text: val(f,"t")}, () => { toast("Appeal sent to senior moderators"); }); }),
  userAction: withModal(ORIG.userAction, (f, el) => { const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("user.action", {user: el.dataset.user, a: f.elements.a.value, reason: r}, () => { toast("Done. It's in the audit log."); }); }),
  resolve: withModal(ORIG.resolve, (f, el) => { const r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("report.resolve", {id: +el.dataset.id, do: el.dataset.op, reason: r}); }),
  clearAvatar: withModal(ORIG.clearAvatar, (f, el) => viaApi("user.clear", {user: el.dataset.user, what:"avatar", reason: val(f,"reason")}, () => { toast("Avatar removed"); })),
  clearSig: withModal(ORIG.clearSig, (f, el) => viaApi("user.clear", {user: el.dataset.user, what:"sig", reason: val(f,"reason")}, () => { toast("Signature cleared"); })),
  avatarRemove(){ act("avatar.remove", {}, "Picture removed"); },
  avatarColor(el){ act("avatar.color", {c: el.dataset.c}); },
  // Messages
  convAdd: withModal(ORIG.convAdd, (f, el) => viaApi("conv.add", {conv: +el.dataset.id, users: val(f,"u").split(/[,\s]+/).filter(Boolean)})),
  convRename: withModal(ORIG.convRename, (f, el) => viaApi("conv.rename", {conv: +el.dataset.id, title: val(f,"t")})),
  convLeave: withModal(ORIG.convLeave, (f, el) => viaApi("conv.leave", {conv: +el.dataset.id}, () => { CONVS = CONVS.filter(c => c.id !== +el.dataset.id); nav("/messages"); })),
  deleteMsg(el){ act("msg.delete", {conv: +el.dataset.conv, msg: +el.dataset.msg}); },
  block(el){ if (el.dataset.user === S.user) return toast("You can't block yourself."); act("block.toggle", {user: el.dataset.user}, res => res.on ? `Blocked ${el.dataset.user}. They can't message you.` : `Unblocked ${el.dataset.user}`); },
  // Admin → Moderators: role changes go to the server; board lists and templates are saved as settings
  appointMod: withModal(ORIG.appointMod, async f => {
    const name = val(f,"u"), u = USERS[name]; if (!u) return "Pick a member."; const t = MOD_TEMPLATES.find(x => x.id === val(f,"t"));
    const bs = BOARDS.filter(b => f.elements["b_"+b.slug] && f.elements["b_"+b.slug].checked); if (!t.allBoards && !bs.length) return "Pick at least one board, or use a template that covers all boards.";
    try {
      await api("user.role", {user:name, role: t.allBoards ? "senior_moderator" : "moderator", badges: [...new Set([...(u.badges||[]), "Moderator"])], reason: val(f,"r") || "Appointed moderator",
        note:`You've been appointed ${t.name}. Your tools are in the moderation queue.`});
      MOD_PROFILES[name] = {template:t.id, allow:new Set(), deny:new Set(), suspendMaxDays: t.allBoards ? 30 : 7};
      bs.forEach(b => { if (!b.mods.includes(name)) b.mods.push(name); });
      await pushDocs(); toast(`${name} is now a moderator`);
    } catch(e){ return e.message; } }),
  removeMod: withModal(ORIG.removeMod, (f, el) => { const u = USERS[el.dataset.user], r = val(f,"reason"); if (r.length < 3) return "Give a reason so the audit log is useful.";
    return viaApi("user.role", {user:u.name, role:"trusted", badges:(u.badges||[]).filter(b => !/moderator/i.test(b)), reason:r, note:"Your moderator role has ended. Thank you for your help."}); }),
  // Ads: clicks are counted, external links open in a new tab, affiliate links go through the tracked /go/ redirect
  adClick(el){ const b = BANNERS.find(x => x.id === +el.dataset.id); if (!b) return; countClick("banner", b.id);
    const al = b.partner && affLinkFor(b.partner);
    if (al) return openOut(`/go/${encodeURIComponent(al.slug)}?p=banner`);
    if (b.dest.startsWith("/")) return go(b.dest); openOut(b.dest); },
  railClick(el){ const a = SIDE_ADS.find(x => x.id === +el.dataset.id); if (!a) return; countClick("side", a.id);
    if (!isExt(a.dest)) return go(a.dest); openOut(a.dest); },
  postAdClick(el){ const a = POST_ADS.find(x => x.id === +el.dataset.id); if (!a) return; countClick("post", a.id);
    if (!isExt(a.dest)) return go(a.dest); openOut(a.dest); },
  affGo(el){ const l = affById(el.dataset.id), p = el.dataset.p || "direct";
    if (!l || l.status !== "active") return toast("This offer isn't available right now.");
    if (el.dataset.ad) countClick("post", +el.dataset.ad); if (el.dataset.slot) countClick("side", +el.dataset.slot);
    openOut(`/go/${encodeURIComponent(l.slug)}?p=${encodeURIComponent(p)}`); }
});
// Later-phase actions explain themselves instead of pretending to work
["writeReview","rvote","editReview","respondReview","disputeReview","reviewStatus","fileComplaint","addEvidence","toggleEvidence","caseFollow","caseTake","caseStatus","caseOutcome","caseSolved","caseWithdraw",
 "claim","editOperator","blacklistOp","unblacklist","setWarning","newListing","listingStatus","featureReq","leaveFeedback","dispute","removeListing","approveListing","rejectListing",
 "buyEscrow","escrowDeposit","escrowCancel","escrowShip","escrowRelease","escrowRefund","escrowDispute","escrowDecide","escrowSkip","verifStep","verifSubmit","sellerApprove","sellerReject","sellerRevoke"]
  .forEach(k => { if (ACT[k]) ACT[k] = () => toast("This part of Pitchside opens in a later phase."); });
openReport = function(kind, data){
  if (!signedIn()) return needSignIn("Sign in to report content.");
  if (!["post","topic","message","user"].includes(kind)) return toast("Reporting this opens in a later phase.");
  modal({title:"Report", submit:"Send report", body:`<label>What's wrong?<select name="why">${["Spam","Abuse or harassment","Scam or fraud","Off-topic","Misinformation","Copyright","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label>
    <label>Details <span class="hint">Optional. Moderators see this.</span><textarea name="details" style="min-height:70px"></textarea></label>`,
    onSubmit: f => viaApi("report.create", {kind, topic: +data.topic || null, post: +data.post || null, msg: +data.msg || null, user: data.user || null, why: val(f,"why"), details: val(f,"details")},
      () => { toast("Reported. A moderator will review it."); }) });
};
// New conversation (direct, group, or with staff)
async function uploadAll(input){
  const files = input && input.files ? [...input.files] : [], out = [];
  for (const file of files){
    if (file.size > 10e6) throw new Error(`${file.name} is over the 10 MB limit.`);
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/upload", {method:"POST", body:fd, credentials:"same-origin", headers:{"X-Requested-With":"pitchside", "X-CSRF":PS.csrf || ""}});
    const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) throw new Error(d.error || `${file.name} couldn't be uploaded.`);
    out.push({id:d.id});
  }
  return out;
}
const ORIG_openNewMessage = openNewMessage;
openNewMessage = function(to="", body=""){
  const before = modalSubmit; ORIG_openNewMessage(to, body);
  if (modalSubmit === before) return;
  modalSubmit = async f => {
    const names = [...new Set(val(f,"to").split(/[,\s]+/).map(s => s.replace(/^@/,"").trim()).filter(Boolean))];
    if (!names.filter(n => n !== S.user).length) return "Add at least one member to send to.";
    try { const att = await uploadAll(f.elements.files);
      const res = await api("conv.create", {to:names, title: val(f,"title"), body: val(f,"body"), att}); nav("/messages/" + res.id); }
    catch(e){ return e.message; }
  };
};
openStaffConv = function(members, title, body){
  if (!signedIn()) return needSignIn("Sign in to contact staff.");
  api("conv.create", {to:members, title: title || "", body: body || "", kind:"staff"}).then(res => go("/messages/" + res.id)).catch(e => toast(e.message));
};
Object.assign(FORMS, {
  reply(f){ const t = topic(f.dataset.topic), body = f.elements.body.value.trim(); if (!body) return toast("Write something first.");
    const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
    api("post.reply", {topic:t.id, body}).then(res => { f.elements.body.value = "";
      S.ui.pages = S.ui.pages || {}; S.ui.pages["t:"+t.id] = Math.ceil(visiblePosts(topic(t.id)).length / 10);
      render(); const el = document.getElementById("post-" + res.id); if (el) el.scrollIntoView({block:"center"}); toast("Reply posted"); })
      .catch(e => toast(e.message)).finally(() => { if (btn) btn.disabled = false; }); },
  vote(f){ const picked = $$("input[name=opt]:checked", f).map(x => +x.value); if (!picked.length) return toast("Pick an option.");
    act("poll.vote", {id: +f.dataset.topic, opts: picked}, "Vote counted"); },
  sendMsg(f){ const c = CONVS.find(x => x.id === +f.dataset.conv), body = f.elements.body.value.trim();
    if (!body && !(f.elements.files && f.elements.files.files.length)) return toast("Write a message or attach a file.");
    const notice = !!(f.elements.notice && f.elements.notice.checked);
    uploadAll(f.elements.files).then(att => api("msg.send", {conv:c.id, body, att, notice})).then(() => { (S.ui.drafts || (S.ui.drafts = {}))[c.id] = ""; render(); $("#msgBody")?.focus(); })
      .catch(e => toast(e.message)); },
  profile(f){ act("profile.update", {about: f.elements.about.value.trim(), website: f.elements.website.value.trim(), favTeams: [...f.elements.teams.selectedOptions].map(o => o.value)}, "Profile saved"); },
  signature(f){ const sig = f.elements.sig.value.replace(/\r/g, "").trim();
    if (sig.split("\n").length > 3) return toast("Keep your signature to 3 lines."); if (sig.length > 200) return toast("Keep your signature to 200 characters.");
    api("signature.update", {sig}).then(() => api("prefs.set", {k:"hideSigs", v: f.elements.hide.checked})).then(() => { toast(sig ? "Signature saved" : "Signature removed"); render(); }).catch(e => toast(e.message)); },
  userLookup(f){ const u = f.elements.u.value.trim(); if (u) go("/members/" + u); }
});
Object.assign(CHANGE, {
  setRole(el){ const name = el.dataset.user, prev = USERS[name].role;
    api("user.role", {user:name, role:el.value}).then(() => { toast(`${name} is now ${roleLabel(el.value)}`); render(); }).catch(e => { el.value = prev; toast(e.message); }); },
  modTpl(el){ const name = el.dataset.user, p = modProfile(name), t = MOD_TEMPLATES.find(x => x.id === el.value), role = t.allBoards ? "senior_moderator" : "moderator";
    p.template = t.id; p.allow = new Set(); p.deny = new Set();
    pushDocs().then(() => USERS[name].role !== role ? api("user.role", {user:name, role, reason:"Template changed"}) : null).then(() => { toast(`${name} now uses “${t.name}”`); render(); }).catch(e => toast(e.message)); },
  privDms(el){ act("prefs.set", {k:"dms", v:el.value}, "Message privacy saved"); },
  privAct(el){ act("prefs.set", {k:"showActivity", v:el.checked}, "Saved"); },
  notify(el){ act("prefs.set", {k:"notify." + el.dataset.k, v:el.checked}, "Saved"); },
  avatarFile(el){ const file = el.files && el.files[0]; if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast("Use a JPG, PNG, WebP or GIF image."); el.value = ""; return; }
    if (file.size > 5e6) { toast("Pictures must be under 5 MB."); el.value = ""; return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const side = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 320;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 320, 320); URL.revokeObjectURL(url);
      act("avatar.set", {data: c.toDataURL("image/jpeg", 0.9)}, "Avatar updated"); };
    img.onerror = () => { URL.revokeObjectURL(url); toast("That image couldn't be read. Try another file."); };
    img.src = url; }
});
INPUT.memq = el => { S.ui.memq = el.value; render(); clearTimeout(PS.memT);
  if (el.value.trim().length >= 2) PS.memT = setTimeout(() => api("members.find", {q: el.value.trim()}).then(res => { Object.entries(res.users || {}).forEach(([n, u]) => { if (!USERS[n]) USERS[n] = liveUser(u); }); render(); }).catch(() => {}), 300); };
// Affiliate clicks are logged by the server's /go/ redirect, not in the browser
logAffClick = function(){};
leaveTo = function(url){ openOut(url); };

/* ---------- Start ---------- */
apply(window.PS_BOOT);
try { if (!S.user && localStorage.getItem("ps_age") === "1") S.ageOk = true; } catch(e){}
S.path = location.pathname + location.search;
appInit();
renderTicker(true);
if (new URLSearchParams(location.search).get("join") && !S.user) ACT.register();

/* ---------- Admin → System on the live site: real job status, fixtures feed, search engines ---------- */
function liveSystemPanels(){
  const j = STATS.jobs || {}, when = t => t ? `${dstr(t)} (${rel(t)})` : "never";
  return `<section class="panel form"><h3 class="ph">Fixtures and match threads</h3>
    <p class="muted" style="margin:0;font-size:.9rem">The forum reads fixtures from your live scores site every 5 minutes and opens a match thread ${esc(String(SETTINGS.matchThreadLeadHrs || 2))} hours before kick-off.</p>
    <label>Fixtures feed address <span class="hint">A JSON list of matches from the live scores site (see the README)</span><input class="inp" type="url" value="${esc(SETTINGS.fixturesFeed || "")}" data-change="setting" data-k="fixturesFeed" id="fixturesFeed" placeholder="https://scores.yourdomain.com/feed/fixtures.json"></label>
    <dl class="kv" style="font-size:.88rem"><dt>Last fixtures import</dt><dd>${esc(j.fixtures || "not set up yet")}</dd><dt>Background jobs last ran</dt><dd>${when(j.cron)}</dd></dl></section>
  <section class="panel form"><h3 class="ph">Search engines</h3>
    <label class="chk"><input type="checkbox" ${SETTINGS.siteIndexing ? "checked" : ""} data-change="siteIndexing" id="siteIndexing"> Let Google and other search engines index the forum</label>
    <p class="hint" style="margin:0">Leave this off until launch. When on, public boards and topics are listed in /sitemap.xml and robots.txt allows crawling.</p></section>
  <section class="panel"><h3 class="ph">Email and backups</h3><dl class="kv" style="font-size:.88rem">
    <dt>Email (SMTP)</dt><dd>${STATS.mailReady ? "Set up" : '<span class="pill amber">Not set up</span>'}</dd>
    <dt>Last database backup</dt><dd>${when(j.backup)}</dd><dt>Copied off the server</dt><dd>${j.offsite ? when(j.offsite) : '<span class="pill amber">Not set up</span>'}</dd></dl>
    <p class="hint muted" style="margin:8px 0 0;font-size:.82rem">Backups run nightly on the server (kept for 14 days). See the README to copy them to Backblaze B2 or another off-site store.</p></section>`;
}
CHANGE.siteIndexing = el => { SETTINGS.siteIndexing = el.checked; toast(el.checked ? "Search engines can index the forum" : "Hidden from search engines"); };
