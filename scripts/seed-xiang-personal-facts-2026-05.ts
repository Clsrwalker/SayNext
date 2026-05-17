import { conversationLogger, type PersonalMemorySensitivity } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

type MemorySeed = {
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  sourceRef: string;
};

const memories: MemorySeed[] = [
  {
    title: "Xiang current Summer 2026 courses",
    category: "identity_education",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:summer-courses",
    keywords: ["summer term", "current courses", "Dalhousie", "MACS", "cloud", "deep learning", "recommender systems"],
    content: `As of May 2026, Xiang is in the 2025/2026 Summer term at Dalhousie.
Current registered courses:
- CSCI 5411 Advanced Cloud Architecting, May 11 to June 26, 2026, Monday/Wednesday 3:05 PM-5:55 PM, instructor Lu Yang.
- CSCI 5501 Deep Learning Applications, May 11 to August 11, 2026, Tuesday/Thursday 10:05 AM-11:25 AM, tutorial Friday 10:05 AM-11:25 AM, instructor Janarthanan Rajendran.
- CSCI 6517 Recommender Systems, May 11 to August 11, 2026, Monday/Wednesday 11:05 AM-12:55 PM, instructor Ga Wu.
He is currently focused on cloud, deep learning, recommender systems, and AI software applications.`,
    usageRule: "Use when asked about current study, current semester, current courses, class schedule, or what Xiang is learning now. Do not volunteer exact schedule details unless the question is about schedule or school logistics.",
  },
  {
    title: "Xiang previous Fall 2025 and Winter 2026 courses",
    category: "identity_education",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:past-courses",
    keywords: ["past courses", "fall 2025", "winter 2026", "Dalhousie", "web development", "mobile computing"],
    content: `Xiang's recent Dalhousie course history:
Fall 2025:
- CSCI 5308 Advanced Topics in Software Development, instructor Tushar Sharma.
- CSCI 5100 Communicating Computer Science Ideas, instructor Carla Heggie.
- CSCI 5408 Data Management, Warehousing and Analytics, instructor Gabriel Spadon De Souza.
Winter 2026:
- CSCI 5409 Advanced Topic in Cloud Computing, instructor Lu Yang.
- CSCI 5709 Advanced Topics in Web Development, instructor Gabriella Mosquera.
- CSCI 5708 Mobile Computing, instructor Hanieh Shakeri.
- CSCI 9890 Internship Preparation, instructor Caroline Lodge.
These courses connect with Xiang's interests in cloud computing, web/mobile development, data systems, and practical software projects.`,
    usageRule: "Use when asked what courses Xiang took before, what his academic background is, or how his courses connect to projects. Keep the answer concise.",
  },
  {
    title: "Xiang favorite current subjects and motivation",
    category: "learning_style",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:favorite-subjects",
    keywords: ["favorite subject", "deep learning", "cloud architecture", "AI software", "projects"],
    content: `Xiang's favorite subjects right now are Deep Learning Applications and Advanced Cloud Architecting.
He likes Cloud Architecting because he has built many software/cloud projects and wants to understand how to build better systems.
He likes Deep Learning because he is interested in combining AI and deep learning to build more capable AI software.
A natural spoken answer: "Probably deep learning and cloud architecture. I did a lot of projects before, so cloud feels pretty useful to me. And I also like AI, so deep learning feels like something I can use to build better AI software."`,
    usageRule: "Use for IELTS/study/interview questions about favorite subject, current interests, why cloud, why deep learning, or what Xiang likes studying.",
  },
  {
    title: "Why Xiang chose computer science",
    category: "identity_education",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:why-computer-science",
    keywords: ["computer science", "major", "why choose CS", "software", "money", "projects"],
    content: `Xiang did not have a clear goal at the beginning. He chose Computer Science partly because he thought it could lead to a good income and stable career.
Later, after building projects, he gradually started to like Computer Science as a subject.
A natural spoken answer: "At first, to be honest, I didn't really have a clear goal. I chose computer science partly because I thought it could lead to a good job. But after I started doing projects, I slowly got more interested in it."`,
    usageRule: "Use when asked why Xiang chose Computer Science, why his major, or how he became interested in software. Keep the answer honest and not too polished.",
  },
  {
    title: "Xiang sleep schedule and daily routine",
    category: "lifestyle",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:sleep-routine",
    keywords: ["sleep", "routine", "morning", "after school", "library", "games", "project"],
    content: `Xiang's sleep schedule is irregular. Sometimes he wakes up late, sometimes he sleeps early because of class, and sometimes he may stay up all night when working on a project.
After class, he usually keeps things simple: class, studying, library, and sometimes playing games to relax.
A natural answer: "My schedule is honestly kind of messy. Sometimes I sleep early because of class, sometimes I wake up late, and if I'm working on a project I might stay up really late. After class I usually study a bit, maybe go to the library, and then play games if I want to relax."`,
    usageRule: "Use for daily routine, morning/evening, after school, sleep, free time, or weekend questions. Do not make Xiang sound disciplined or overly productive.",
  },
  {
    title: "Xiang home, room and personal space",
    category: "lifestyle",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:home-room",
    keywords: ["home", "room", "bedroom", "cozy", "school residence", "personal space", "small room"],
    content: `Xiang currently lives in a small school residence room. He thinks the place is small but comfortable.
His favorite room is basically his bedroom, because the room is small, cozy, and gives him a sense of safety. His desk and bedroom area are connected in one compact space.
He likes small private spaces because they feel safe and comfortable.
A natural answer: "Probably my bedroom. My room is pretty small, but honestly I like that. My desk and bed are basically in the same small space, and it feels kind of cozy and safe."`,
    usageRule: "Use when asked about home, favorite room, room where Xiang spends most time, or whether he likes where he lives. Do not mention exact residence name or address.",
  },
  {
    title: "Xiang going out and parks",
    category: "lifestyle",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:parks-going-out",
    keywords: ["go out", "park", "walk", "alone", "homebody", "relax"],
    content: `Xiang is mostly a homebody, but he sometimes goes out alone for a walk in a park.
He does not go out mainly for socializing. Going to a park alone is more like a quiet way to relax.
A natural answer: "I don't go out that much, but sometimes I go to a park by myself and just walk around a bit. It's more for relaxing, not really for socializing."`,
    usageRule: "Use for questions about going out, outdoor activities, parks, free time, or whether Xiang prefers indoor/outdoor life.",
  },
  {
    title: "Xiang Reddit and internet habits",
    category: "lifestyle",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:reddit-internet",
    keywords: ["reddit", "website", "app", "internet", "news", "memes", "current events"],
    content: `Xiang's favorite website/app is probably Reddit.
He uses Reddit to read news, memes, internet discussions, and current events.
A natural answer: "Probably Reddit. I use it to check news, random discussions, memes, and just what's happening online."`,
    usageRule: "Use when asked about favorite website, favorite app, internet habits, online news, memes, or social media style.",
  },
  {
    title: "Xiang anime, TV and film preferences",
    category: "entertainment",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:anime-tv-film",
    keywords: ["anime", "TV", "movies", "films", "Game of Thrones", "The Boys", "Breaking Bad", "subtitles"],
    content: `Xiang likes anime and usually watches currently popular anime.
For TV shows, he selectively watches popular series. Examples he likes include Game of Thrones, The Boys, and Breaking Bad.
He used to watch many movies before moving to Canada, but after coming to Canada he watched fewer movies because many movies did not have subtitles, which made him uncomfortable at the time. Even after his English improved, he did not fully rebuild the habit of watching movies.
A natural answer: "I watch anime more. If there's a popular anime, I'll probably check it out. For TV shows, I only watch some big ones, like Game of Thrones, The Boys, or Breaking Bad. Movies, not that much now."`,
    usageRule: "Use for entertainment, anime, TV shows, film/movie preference, subtitles, or cinema questions. Keep it casual.",
  },
  {
    title: "Xiang music listening habits",
    category: "music",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:music-listening",
    keywords: ["music", "headphones", "alone", "quiet", "listen to music"],
    content: `Xiang can listen to music almost anywhere as long as he has headphones.
He prefers listening alone or in a quiet/private setting rather than in a noisy or crowded place.
A natural answer: "I don't really care where, as long as I have headphones. But I prefer listening by myself, not really in a loud or crowded place."`,
    usageRule: "Use for IELTS/music questions about where Xiang listens to music or how he enjoys music.",
  },
  {
    title: "Xiang shopping and clothing style",
    category: "lifestyle",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:shopping-clothes",
    keywords: ["shopping", "online shopping", "delivery", "takeout", "Superstore", "clothes", "fashion", "black", "white"],
    content: `Xiang does not enjoy shopping much. He mostly goes out for groceries or food, such as going to Superstore, but much of the time he prefers delivery or online shopping.
He does not care much about fashion. His clothing style is simple and low-effort, often black clothes and white pants or similar basic combinations.
A natural answer: "I don't really care that much about shopping or fashion. If I need groceries I might go to Superstore, but a lot of the time I just order delivery or buy things online. For clothes, I usually just wear something simple, like black and white."`,
    usageRule: "Use for shopping, online shopping, clothes, fashion, grocery, takeout, or daily convenience questions.",
  },
  {
    title: "Xiang car and driving to school",
    category: "lifestyle",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:driving-car",
    keywords: ["car", "drive", "driving", "school", "license", "driver test", "Honda Civic", "Hatchback Sport", "Kentville", "dealership"],
    content: `Xiang usually drives to school.
He owns a black 2025 Honda Civic Hatchback Sport. He bought it from a dealership in Kentville for about CAD 45,000 including tax.
He has a car, but he does not drive a lot; after almost a year the mileage was still only a few thousand kilometers.
He got a driver's licence in China around 2024 and later converted/continued the process in Canada. Because of timing rules, he still had to pass the Canadian written test and road test to get his local licence.
A natural answer: "I usually drive to school. I have a black 2025 Honda Civic Hatchback Sport, but honestly I don't drive that much. I bought it in Kentville, around 45k including tax."`,
    usageRule: "Use when asked how Xiang travels to school, whether he drives, or car/license questions. Do not volunteer car details if irrelevant.",
  },
  {
    title: "Xiang English learning history and weakness",
    category: "speaking_style",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:english-learning",
    keywords: ["English", "learning English", "vocabulary", "YouTube", "Canada", "speaking", "IELTS"],
    content: `Xiang started learning English when he was young, but he did not put much effort into it at first.
After moving to Canada for high school, English became necessary for daily life and communication, so he had to force himself to improve.
He improved through watching videos, especially YouTube, reading, and talking with people.
His current weak point is advanced vocabulary. He can remember basic IELTS wording and professional technical terms, but he does not actively memorize many advanced general words now.
A natural answer: "I started learning English pretty early, but honestly I didn't try that hard when I was younger. After I came to Canada, I had to use English every day, so I slowly improved by watching YouTube, reading, and talking to people. My weak point is probably advanced vocabulary."`,
    usageRule: "Use for questions about English learning, language confidence, IELTS speaking, vocabulary weakness, or adapting to Canada.",
  },
  {
    title: "Xiang future tech job and dream job",
    category: "values_immigration",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:future-job",
    keywords: ["future job", "dream job", "tech job", "mobile app", "web app", "AI software", "career"],
    content: `Xiang's preferred future tech job is related to mobile apps, web apps, and AI-integrated software.
His practical dream job is not a dramatic "dream job" story; it is a stable tech role where he can build useful software, especially apps that combine software engineering with AI.
A natural answer: "Probably something around mobile apps, web apps, or AI-related software. I don't really have a super dramatic dream job, but I want a stable tech job where I can build things that are actually useful."`,
    usageRule: "Use when asked about future job, dream job, career goal, preferred role, or what kind of tech work Xiang wants.",
  },
  {
    title: "Xiang work-life balance and disliked work environment",
    category: "values_immigration",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:work-life-balance",
    keywords: ["work-life balance", "996", "China work environment", "personal space", "overtime", "privacy"],
    content: `Work-life balance is important to Xiang because he needs rest to function. If he does not rest enough, he feels low-energy for the whole day.
He dislikes highly intense work environments with little personal space, constant interaction, little privacy, and frequent overtime. He especially dislikes the 996-style work culture.
A natural answer: "Yeah, work-life balance is pretty important to me. If I don't rest enough, I feel useless the whole day. I don't really like the kind of work environment where everyone is always packed together, talking loudly, no privacy, and working overtime all the time."`,
    usageRule: "Use for work-life balance, preferred workplace, overtime, China work culture, privacy, or why stable life in Canada matters. Keep it careful and framed as Xiang's personal preference.",
  },
  {
    title: "Xiang childhood home and good memories",
    category: "education_history",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05:childhood-home",
    keywords: ["childhood", "home", "Chengdu", "community", "friends", "no elevator", "warm memory"],
    content: `When Xiang was a child, he lived with his parents in a residential community in Chengdu. It was a fifth-floor home without an elevator, so climbing stairs was tiring.
Despite that, he remembers it warmly because he could go downstairs and play with other kids in the community. There were many children around his age, and this is one of his good childhood memories.
A privacy-safe answer: "When I was a kid, I lived in a residential community in Chengdu with my parents. It was on the fifth floor and there was no elevator, so that part was kind of tiring. But I remember it pretty warmly, because I could go downstairs and play with other kids in the community."`,
    usageRule: "Use only when directly asked about childhood home, childhood memories, where Xiang lived as a child, or childhood friends. Do not mention exact community name unless Xiang explicitly asks.",
  },
  {
    title: "Xiang childhood favorite subject and biology interest",
    category: "learning_style",
    sensitivity: "medium",
    sourceRef: "xiang-update:2026-05:childhood-biology",
    keywords: ["childhood subject", "biology", "favorite subject", "school", "major"],
    content: `As a child, Xiang liked biology. Before university, he once considered studying biology.
He later gave up that idea because he felt biology might become too difficult for him later and might not be the right path under personal pressure.
A natural answer: "When I was younger, I actually liked biology. At one point before university I even thought about studying it, but later I felt it might be too hard for me and maybe not the best path, so I gave up that idea."`,
    usageRule: "Use for questions about favorite school subject, childhood subject, biology, or why he did not choose biology.",
  },
  {
    title: "Xiang fruit preference",
    category: "lifestyle",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:fruit",
    keywords: ["fruit", "pineapple", "orange", "sweet and sour"],
    content: `Xiang's favorite fruit is probably pineapple. He likes sweet-and-sour fruit, and oranges are also good.
A natural answer: "Probably pineapple. I like fruit that tastes sweet and sour. Oranges are pretty good too."`,
    usageRule: "Use for simple IELTS or daily questions about fruit preferences.",
  },
  {
    title: "Xiang piano learning experience",
    category: "learning_style",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:piano-learning",
    keywords: ["piano", "keyboard", "electronic keyboard", "learned skill", "youtube", "both hands", "frustrating", "hobby"],
    content: `Xiang does not really know how to play piano now.
He learned piano in a more systematic way for a short period when he was very young, probably around Grade 1 or Grade 2, but later stopped and forgot most of it.
He tried to pick piano up again later by following online videos and simple songs, and he even bought an electronic keyboard, but because of schoolwork and being busy he did not keep practicing consistently.
The difficult part was coordinating both hands at the same time. It felt frustrating when the left and right hand rhythms did not match.
A natural answer: "I can't really play piano now. I learned a bit when I was really young, maybe Grade 1 or 2, but I stopped and basically forgot it. Later I tried to pick it up again and even bought a keyboard, but I got busy with school and didn't keep practicing."`,
    usageRule: "Use for IELTS or daily questions about learning a new skill, a difficult hobby, music practice, piano, keyboard, or learning from online videos. Do not claim Xiang can play piano well now.",
  },
  {
    title: "Xiang musical instrument background",
    category: "music",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:music-instruments",
    keywords: ["musical instrument", "instrument", "saxophone", "school band", "concert band", "performance", "harp", "piano", "keyboard"],
    content: `Xiang learned harp briefly when he was a child.
From primary school through middle school and high school, he played saxophone and was fairly good at it. He joined the school concert band / wind band and performed with the band.
After moving abroad, he stopped playing saxophone and has not really touched it since.
He does not currently practice instruments regularly.
A natural answer: "I used to play saxophone when I was in school. I played it from primary school through high school and even joined the school band, so I was not bad at it. But after I went abroad, I basically stopped and haven't touched it for years."`,
    usageRule: "Use for questions about musical instruments, saxophone, school band, performances, music experience, or whether Xiang plays an instrument. Do not make it sound like he currently performs or practices regularly.",
  },
  {
    title: "Xiang current family details",
    category: "family_events",
    sensitivity: "high",
    sourceRef: "xiang-update:2026-05:family-current-details",
    keywords: ["family", "mother", "mom", "sister", "older sister", "niece", "married", "daughter", "Uncle Zhao", "age gap"],
    content: `Xiang has an older sister who is 9 years older than him. Since Xiang was born on March 16 and is 25 as of 2026, this implies his sister was born around 1992; do not present an exact birthday unless Xiang provides one.
Xiang's mother had him when she was around 30. This implies his mother was born around 1970 or 1971; do not present an exact birthday unless Xiang provides one.
After Xiang's father passed away, his mother later became partners with Uncle Zhao. They did not get married, but they chose to live together and take care of each other.
Xiang's older sister got married in 2025 and currently has a daughter, Xiang's niece.
A privacy-safe answer: "I have an older sister, she's about nine years older than me. She got married in 2025 and has a daughter now. My mom also has someone who takes care of her and lives with her, but they're not officially married."`,
    usageRule: "Use only when directly asked about Xiang's family, sister, mother, niece, age gap, or family situation. Keep the answer brief and do not volunteer sensitive family details in casual unrelated conversations.",
  },
  {
    title: "Xiang swimming ability and exercise preference",
    category: "lifestyle",
    sensitivity: "low",
    sourceRef: "xiang-update:2026-05:swimming",
    keywords: ["swimming", "exercise", "sport", "freestyle", "breaststroke", "butterfly"],
    content: `Xiang especially likes swimming and is good at it. Among sports, swimming is the one he feels best at.
He can do freestyle, breaststroke, and butterfly.
A natural answer: "If I had to pick one sport, probably swimming. I'm actually pretty good at it. I can do freestyle, breaststroke, and butterfly, and I feel more comfortable in water than in most other sports."`,
    usageRule: "Use for questions about sports, exercise, active hobbies, swimming, or what sport Xiang enjoys.",
  },
];

let count = 0;
for (const memory of memories) {
  const result = conversationLogger.createPersonalMemory({
    userId,
    title: memory.title,
    category: memory.category,
    sensitivity: memory.sensitivity,
    content: memory.content,
    usageRule: memory.usageRule,
    keywords: memory.keywords,
    source: "import",
    sourceRef: memory.sourceRef,
    upsertBySource: true,
  });

  if (result) {
    count += 1;
    console.log(`${result.id}: ${result.title} [${result.category}]`);
  }
}

conversationLogger.rebuildPersonalMemoryFts(userId);
console.log(`Upserted ${count} personal memories for ${userId}.`);
