import { ClientEvents, Collection, GuildTextBasedChannel, Message, RichPresence } from "discord.js-selfbot-v13";

import path from "node:path";

import { ranInt } from "@/utils/math.js";
import { logger } from "@/utils/logger.js";
import { watchConfig } from "@/utils/watcher.js";
import {
    AwaitResponseOptions,
    AwaitSlashResponseOptions,
    CommandProps,
    FeatureProps,
    SendMessageOptions
} from "@/typings/index.js";

import { Configuration } from "@/schemas/ConfigSchema.js";
import featuresHandler from "@/handlers/featuresHandler.js";
import { t, getCurrentLocale } from "@/utils/locales.js";
import { shuffleArray } from "@/utils/array.js";
import commandsHandler from "@/handlers/commandsHandler.js";
import eventsHandler from "@/handlers/eventsHandler.js";

import { ExtendedClient } from "./core/ExtendedClient.js";
import { CooldownManager } from "./core/CooldownManager.js";
import { fileURLToPath } from "node:url";
import { CriticalEventHandler } from "@/handlers/CriticalEventHandler.js";

export class BaseAgent {
    public readonly rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

    public readonly miraiID = "1205422490969579530"

    public readonly client: ExtendedClient<true>;
    public config: Configuration;
    private cache: Configuration;
    public authorizedUserIDs: string[] = [];

    public commands = new Collection<string, CommandProps>();
    public cooldownManager = new CooldownManager();
    public features = new Collection<string, FeatureProps>();

    public owoID = "408785106942164992"
    public prefix: string = "owo";

    public activeChannel!: GuildTextBasedChannel;

    public totalCaptchaSolved = 0;
    public totalCaptchaFailed = 0;
    public totalCommands = 0;
    public totalTexts = 0;

    private invalidResponseCount = 0;
    private invalidResponseThreshold = 5;

    gem1Cache?: number[];
    gem2Cache?: number[];
    gem3Cache?: number[];
    starCache?: number[];

    public channelChangeThreshold = ranInt(17, 56);
    public autoSleepThreshold = ranInt(32, 600);
    public lastSleepAt = 0;

    public captchaDetected = false;
    public farmLoopRunning = false;
    public farmLoopPaused = false;
    private expectResponseOnAllAwaits = false;

    constructor(client: ExtendedClient<true>, config: Configuration) {
        this.client = client;
        this.cache = structuredClone(config);
        this.config = watchConfig(config, (key, oldValue, newValue) => {
            logger.debug(`Configuration updated: ${key} changed from ${oldValue} to ${newValue}`);
        })

        this.authorizedUserIDs.push(
            this.client.user.id,
            ...(this.config.adminID ? [this.config.adminID] : []),
        );

        this.client.options.sweepers = {
            messages: {
                interval: 60 * 60,
                lifetime: 60 * 60 * 24,
            },
            users: {
                interval: 60 * 60,
                filter: () => (user) => this.authorizedUserIDs.includes(user.id),
            },
        }
    }

    public setActiveChannel = (id?: string): GuildTextBasedChannel | undefined => {
        const channelIDs = this.config.channelID;

        if (!channelIDs || channelIDs.length === 0) {
            throw new Error("No channel IDs provided in the configuration.");
        }

        const channelID = id || channelIDs[ranInt(0, channelIDs.length)];
        try {
            const channel = this.client.channels.cache.get(channelID);
            if (channel && channel.isText()) {
                this.activeChannel = channel as GuildTextBasedChannel;
                logger.info(t("agent.messages.activeChannelSet", { channelName: this.activeChannel.name }));

                return this.activeChannel;
            } else {
                logger.warn(t("agent.messages.invalidChannel", { channelID }));
                this.config.channelID = this.config.channelID.filter(id => id !== channelID);
                logger.info(t("agent.messages.removedInvalidChannel", { channelID }));
            }
        } catch (error) {
            logger.error(`Failed to fetch channel with ID ${channelID}:`);
            logger.error(error as Error);
        }
        return;
    }

    public reloadConfig = () => {
        for (const key of Object.keys(this.cache)) {
            (this.config as any)[key as keyof Configuration] = this.cache[key as keyof Configuration];
        }
        logger.info(t("agent.messages.configReloaded"));
    }

    public send = async (content: string, options: SendMessageOptions = {
        channel: this.activeChannel,
        prefix: this.prefix,
    }) => {
        if (!this.activeChannel) {
            logger.warn(t("agent.messages.noActiveChannel"));
            return;
        }

        this.client.sendMessage(content, options)
        if (!!options.prefix) this.totalCommands++;
        else this.totalTexts++;
    }

    private isBotOnline = async () => {
        try {
            const owo = await this.activeChannel.guild.members.fetch(this.owoID);
            return !!owo && owo.presence?.status !== "offline";
        } catch (error) {
            logger.warn(t("agent.messages.owoStatusCheckFailed"));
            return false;
        }
    }

    public awaitResponse = (options: AwaitResponseOptions): Promise<Message | undefined> => {
        return new Promise((resolve, reject) => {
            const {
                channel = this.activeChannel,
                filter,
                time = 30_000,
                max = 1,
                trigger,
                expectResponse = false,
            } = options;

            // 2. Add a guard clause for safety.
            if (!channel) {
                const error = new Error("awaitResponse requires a channel, but none was provided or set as active.");
                logger.error(error.message);
                return reject(error);
            }

            const collector = channel.createMessageCollector({
                filter,
                time,
                max,
            });

            collector.once("collect", (message: Message) => {
                resolve(message);
            });

            collector.once("end", (collected) => {
                if (collected.size === 0) {
                    if (expectResponse || this.expectResponseOnAllAwaits) {
                        this.invalidResponseCount++;
                        logger.debug(`No response received within the specified time (${this.invalidResponseCount}/${this.invalidResponseThreshold}).`);
                    }
                    if (this.invalidResponseCount >= this.invalidResponseThreshold) {
                        reject(new Error("Invalid response count exceeded threshold."));
                    }
                    resolve(undefined);
                } else {
                    logger.debug(`Response received: ${collected.first()?.content.slice(0, 35)}...`);
                    this.invalidResponseCount = 0;
                }
            });

            trigger()
        })
    }

    public awaitSlashResponse = async (options: AwaitSlashResponseOptions) => {
        const {
            channel = this.activeChannel,
            bot = this.owoID,
            command,
            args = [],
            time = 30_000,
        } = options

        if (!channel) {
            throw new Error("awaitSlashResponse requires a channel, but none was provided or set as active.");
        }

        const message = await channel.sendSlash(bot, command, ...args);

        if (!(message instanceof Message)) {
            throw new Error("Unsupported message type returned from sendSlash.");
        }

        if (message.flags.has("LOADING")) return new Promise<Message>((resolve, reject) => {
            let timeout: NodeJS.Timeout;

            const listener = async (...args: ClientEvents["messageUpdate"]) => {
                const [_, m] = args;
                if (_.id !== message.id) return;
                cleanup();

                if (m.partial) {
                    try {
                        const fetchedMessage = await m.fetch();
                        return resolve(fetchedMessage);
                    } catch (error) {
                        logger.error("Failed to fetch partial message");
                        reject(error);
                    }
                } else {
                    resolve(m);
                }
            }

            const cleanup = () => {
                message.client.off("messageUpdate", listener);
                clearTimeout(timeout);
            }

            message.client.on("messageUpdate", listener);

            timeout = setTimeout(() => {
                cleanup();
                reject(new Error("AwaitSlashResponse timed out"));
            }, time);
        })

        return Promise.resolve(message);
    }

    private loadPresence = () => {
        const rpc = new RichPresence(this.client)
            .setApplicationId(this.miraiID)
            .setType("Playing")
            .setName("Lfathh Developer")
            .setDetails("The handsome man is having a headache.!")
            .setStartTimestamp(this.client.readyTimestamp)
            .setAssetsLargeImage("1312264004382621706")
            .setAssetsLargeText("Fath Tools")
            .setAssetsSmallImage("1306938859552247848")
            .setAssetsSmallText("Copyright © lfath 2025")
            .addButton("GitHub", "https://github.com/lfathh")
            .addButton("TikTok", "https://www.tiktok.com/@fxyyxs")

        this.client.user.setPresence({ activities: [rpc] });
    }

    public farmLoop = async () => {
        if (this.farmLoopRunning) {
            logger.debug("Double farm loop detected, skipping this iteration.");
            return;
        }

        if (this.farmLoopPaused) {
            logger.debug("Farm loop is paused, skipping this iteration.");
            return;
        }

        this.farmLoopRunning = true;

        try {
            const featureKeys = Array.from(this.features.keys());
            if (featureKeys.length === 0) {
                logger.warn(t("agent.messages.noFeaturesAvailable"));
                return;
            }

            for (const featureKey of shuffleArray(featureKeys)) {
                if (this.captchaDetected) {
                    logger.debug("Captcha detected, skipping feature execution.");
                    return;
                }

                const botStatus = await this.isBotOnline();
                if (!botStatus) {
                    logger.warn(t("agent.messages.owoOfflineDetected"));
                    this.expectResponseOnAllAwaits = true;
                } else {
                    this.expectResponseOnAllAwaits = false;
                }

                const feature = this.features.get(featureKey);
                if (!feature) {
                    logger.warn(t("agent.messages.featureNotFound", { featureKey }));
                    continue;
                }

                try {
                    const shouldRun = await feature.condition({ agent: this, t, locale: getCurrentLocale() })
                        && this.cooldownManager.onCooldown("feature", feature.name) === 0;
                    if (!shouldRun) continue;

                    const res = await feature.run({ agent: this, t, locale: getCurrentLocale() });
                    this.cooldownManager.set(
                        "feature", feature.name,
                        typeof res === "number" && !isNaN(res) ? res : feature.cooldown() || 30_000
                    );

                    await this.client.sleep(ranInt(500, 4600));
                } catch (error) {
                    logger.error(`Error running feature ${feature.name}:`);
                    logger.error(error as Error);
                }
            }

            if (!this.captchaDetected && !this.farmLoopPaused) {
                setTimeout(() => {
                    this.farmLoop();
                }, ranInt(1000, 7500));
            }

        } catch (error) {
            logger.error("Error occurred during farm loop execution:");
            logger.error(error as Error);
        } finally {
            this.farmLoopRunning = false;
        }
    }

    private registerEvents = async () => {
        CriticalEventHandler.handleRejection({
            agent: this,
            t,
            locale: getCurrentLocale(),
        })

        await featuresHandler.run({
            agent: this,
            t,
            locale: getCurrentLocale(),
        });
        logger.info(t("agent.messages.featuresRegistered", { count: this.features.size }));

        await commandsHandler.run({
            agent: this,
            t,
            locale: getCurrentLocale(),
        });
        logger.info(t("agent.messages.commandsRegistered", { count: this.commands.size }));

        await eventsHandler.run({
            agent: this,
            t,
            locale: getCurrentLocale(),
        });

        if (this.config.showRPC) this.loadPresence();
    }

    public static initialize = async (client: ExtendedClient<true>, config: Configuration) => {
        logger.debug("Initializing BaseAgent...");
        if (!client.isReady()) {
            throw new Error("Client is not ready. Ensure the client is logged in before initializing the agent.");
        }

        const agent = new BaseAgent(client, config);
        agent.setActiveChannel();

        await agent.registerEvents();
        logger.debug("BaseAgent initialized successfully.");
        logger.info(t("agent.messages.loggedIn", { username: client.user.username }));

        agent.farmLoop();
    }
}

