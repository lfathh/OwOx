import fs from "node:fs";
import path from "node:path";

import { Configuration } from "@/schemas/ConfigSchema.js";
import { logger } from "@/utils/logger.js";
import { t } from "@/utils/locales.js";

export const command = "generate [filename]";
export const desc = "Generate a new config file";
export const builder = {
    filename: {
        type: "string",
        default: "config-sample.json",
        description: "The name of the config file to generate",
    },
};
export const handler = async (argv: { filename: string }) => {
    const configTemplate: Partial<Configuration> = {
        token: "imput-token",
        guildID: "GUILD-ID",
        channelID: ["1454544962275377172", "<your-channel-id-2>", "<your-channel-id-3>"],
        wayNotify: ["webhook", "dms", "call", "music", "popup"],
        webhookURL: "webhookURL",
        adminID: "1307385241266032640",
        musicPath: "./path/to/music.mp3",
        prefix: "!",
        captchaAPI: "2captcha",
        apiKey: "",
        autoHuntbot: false,
        autoTrait: "efficiency",
        useAdotfAPI: true,
        autoPray: ["pray", "1052913902054281267"],
        autoGem: 1,
        gemTier: ["common", "uncommon", "rare", "epic", "mythical"],
        useSpecialGem: false,
        autoLootbox: true,
        autoFabledLootbox: false,
        autoQuote: ["owo", "quote"],
        autoRPP: ["run", "pup", "piku"],
        autoDaily: true,
        autoCookie: true,
        autoClover: true,
        useCustomPrefix: false,
        autoSell: true,
        autoSleep: true,
        autoReload: true,
        autoResume: true,
        showRPC: true
    };

    const filePath = path.resolve(process.cwd(), argv.filename);

    if (fs.existsSync(filePath)) {
        logger.error(t("cli.generate.fileExists", { filePath }));
        return;
    }

    fs.writeFileSync(filePath, JSON.stringify(configTemplate, null, 4));
    logger.info(t("cli.generate.configGenerated", { filePath }));

};





