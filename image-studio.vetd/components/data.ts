import printBuds from "../assets/print-buds.jpg";
import printChurch from "../assets/print-church.jpg";
import printForest from "../assets/print-forest.jpg";
import printJetty from "../assets/print-jetty.jpg";
import printLily from "../assets/print-lily.jpg";
import printSteps from "../assets/print-steps.jpg";
import printSucculent from "../assets/print-succulent.jpg";
import printTreeline from "../assets/print-treeline.jpg";

export interface Print {
	id: string;
	src: string;
	alt: string;
	ratio: string;
	request: string;
	sent: string;
	longEdge: string;
	quality: string;
	channel: string;
	model: string;
	service: string;
	elapsed: string;
	prompt: string;
	path: string;
	parent: string | null;
	when: string;
}

export const SERVICE = "https://api.openai.com/v1";
export const MODEL = "gpt-image-2.6";

export const prints: Print[] = [
	{
		id: "8f3c1a2e",
		src: printLily,
		alt: "黑底上一株白色马蹄莲",
		ratio: "2 / 3",
		request: "1024x1536",
		sent: "1024x1536",
		longEdge: "1K",
		quality: "high",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "38.4 s",
		prompt: "一株白色马蹄莲，纯黑背景，侧逆光，胶片颗粒，竖版 2:3",
		path: ".xiaoman/images/8f3c1a2e-1c40-4f2a-9b71-0d5e6a83c914.png",
		parent: null,
		when: "今天 15:42",
	},
	{
		id: "4d02b7c9",
		src: printForest,
		alt: "粉色晨雾里的松树林",
		ratio: "3 / 2",
		request: "1536x1024",
		sent: "2048x1360",
		longEdge: "2K",
		quality: "high",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "41.2 s",
		prompt: "雾中的松树林，粉色晨雾，横版 16:9 壁纸，低饱和",
		path: ".xiaoman/images/4d02b7c9-77aa-4d13-8f0e-2a91c6b4e502.png",
		parent: null,
		when: "今天 14:08",
	},
	{
		id: "b31e6d40",
		src: printTreeline,
		alt: "黑白高反差的雾中树影",
		ratio: "9 / 5",
		request: "1536x1024",
		sent: "2048x1138",
		longEdge: "2K",
		quality: "high",
		channel: "改图",
		model: MODEL,
		service: SERVICE,
		elapsed: "36.9 s",
		prompt: "改成黑白高反差，去掉粉色，只留雾与树影",
		path: ".xiaoman/images/b31e6d40-2f68-4c55-a0d8-71b3e9f0a6c3.png",
		parent: "4d02b7c9",
		when: "今天 14:19",
	},
	{
		id: "c07a5e21",
		src: printSteps,
		alt: "粉色雾中的木栈道",
		ratio: "3 / 4",
		request: "1024x1536",
		sent: "1536x2048",
		longEdge: "2K",
		quality: "high",
		channel: "改图",
		model: MODEL,
		service: SERVICE,
		elapsed: "44.7 s",
		prompt: "同一场景改竖版构图，加前景木栈道，雾更浓",
		path: ".xiaoman/images/c07a5e21-9e3b-42a7-b6f1-58d2a0c7e184.png",
		parent: "4d02b7c9",
		when: "今天 14:31",
	},
	{
		id: "2a91f6bb",
		src: printJetty,
		alt: "雾里的石砌栈桥伸向湖心",
		ratio: "3 / 2",
		request: "1536x1024",
		sent: "2048x1360",
		longEdge: "2K",
		quality: "medium",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "29.8 s",
		prompt: "雾里的石砌栈桥伸向湖心，低饱和，安静",
		path: ".xiaoman/images/2a91f6bb-5c04-4b8e-9d12-6f83b7e0c251.png",
		parent: null,
		when: "昨天 18:26",
	},
	{
		id: "6e4c0d17",
		src: printChurch,
		alt: "高原上阴天里的红顶小教堂",
		ratio: "4 / 3",
		request: "1536x1152",
		sent: "2048x1536",
		longEdge: "2K",
		quality: "high",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "40.1 s",
		prompt: "高原上的红顶小教堂，阴天，广角，灰调",
		path: ".xiaoman/images/6e4c0d17-8a51-4f60-b3c9-02e7d4a95b18.png",
		parent: null,
		when: "昨天 17:55",
	},
	{
		id: "9b58a3f2",
		src: printSucculent,
		alt: "俯拍铺满画面的多肉植物",
		ratio: "2 / 3",
		request: "1024x1536",
		sent: "1024x1536",
		longEdge: "1K",
		quality: "auto",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "26.3 s",
		prompt: "俯拍多肉植物铺满画面，青绿色，做卡片纹理用",
		path: ".xiaoman/images/9b58a3f2-3d77-4a02-8e64-b15c9f0d72a8.png",
		parent: null,
		when: "昨天 16:12",
	},
	{
		id: "5f1d8c04",
		src: printBuds,
		alt: "深青背景上的绿色花苞特写",
		ratio: "3 / 2",
		request: "1536x1024",
		sent: "2048x1360",
		longEdge: "2K",
		quality: "high",
		channel: "文生图",
		model: MODEL,
		service: SERVICE,
		elapsed: "37.5 s",
		prompt: "深青背景上的绿色花苞特写，柔光，微距",
		path: ".xiaoman/images/5f1d8c04-6b29-4c83-a7f0-98e2b5d1c476.png",
		parent: null,
		when: "昨天 15:40",
	},
];

export const byId = (id: string) => prints.find((print) => print.id === id) as Print;

export const sessions = [
	{ name: "百合花 竖版 1K", count: 3 },
	{ name: "雾中松林 4K 横版", count: 8 },
	{ name: "电商海报 主图", count: 12 },
	{ name: "night-bake 封面", count: 5 },
];
