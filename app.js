const { App } = require("@slack/bolt");
require("dotenv").config(); // Load environment variables from .env file (i can send you these on slack DM)

// Initialize Slack app w/ configuration (you probably also need to have a couple of stuff installed)
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

// List of Slack channel IDs where the bot can work (you can add your bot testing channel here)
const ALLOWED_CHANNELS = ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];

// Listen for when a reaction is added to a msg
app.event("reaction_added", async ({ event, client }) => {
  // Only cont. if the reaction is in an allowed channel and is the ban emoji
  if (!ALLOWED_CHANNELS.includes(event.item.channel) || event.reaction !== "ban") return;

  try {
    // Send a message asking if the user wants to file a conduct report
    // This message has a button that opens a modal form
    await client.chat.postMessage({
      channel: event.item.channel,
      thread_ts: event.item.ts, // Reply in thread of the original message
      text: "Wanna file a conduct report?",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Wanna file a conduct report?*" },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "File A Report Here", emoji: true },
              action_id: "open_conduct_modal",
              style: "primary",
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error(error);
  }
});

// The structure of the form
const modalBlocks = [
  {
    type: "input",
    block_id: "reported_user",
    label: { type: "plain_text", text: "User Being Reported?" },
    element: { type: "users_select", action_id: "user_select" },
  },
];

// Handling when someone clicks the "File A Report" button
app.action("open_conduct_modal", async ({ ack, body, client }) => {
  await ack();
  try {
    // Get the perma link to the msg that was reacted to
    const permalinkResponse = await client.chat.getPermalink({
      channel: body.channel.id,
      message_ts: body.message.thread_ts || body.message.ts,
    });

    // Open the modal form
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "conduct_report",
        // Have channel info and message link in the metadata
        private_metadata: JSON.stringify({
          channel: body.channel.id,
          thread_ts: body.message.thread_ts || body.message.ts,
          permalink: permalinkResponse.permalink,
        }),
        title: { type: "plain_text", text: "FD Record Keeping" },
        blocks: modalBlocks,
        submit: { type: "plain_text", text: "Submit" },
      },
    });
  } catch (error) {
    console.error(error);
  }
});

// When the conduct report form is submitted
app.view("conduct_report", async ({ ack, view, client }) => {
  await ack();
  try {
    // Extract form values and metadata, mmhm yummy
    const values = view.state.values;
    const { channel, thread_ts, permalink } = JSON.parse(view.private_metadata);

    // Format the users who resolved the issue
    const resolvedBy = values.resolved_by.resolver_select.selected_users.map((user) => `<@${user}>`).join(", ");

    // Format the ban date
    const banDate = values.ban_until.ban_date_input.selected_date
      ? new Date(values.ban_until.ban_date_input.selected_date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "N/A";

    const reportFields = [
      `*Reported User:*\n<@${values.reported_user.user_select.selected_user}>`,
      `*Resolved By:*\n${resolvedBy}`,
      `*What Did They Do?*\n${values.violation_deets.violation_deets_input.value}`,
      `*How Did We Deal With This?*\n${values.solution_deets.solution_input.value}`,
      `*If Banned, Ban Until:*\n${banDate || "N/A"}`,
      `*Link To Message:*\n${permalink}`,
    ];

    // Post the completed report in thread
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: "Conduct Report Filed :yay:",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Thanks for filling this <3*" },
        },
        {
          type: "section",
          fields: reportFields.map((text) => ({ type: "mrkdwn", text })),
        },
      ],
    });
  } catch (error) {
    console.error(error);
  }
});

// When the /prevreports slash command is used (THIS IS STILL A BIG MESS SO YOU HAVE BEENWARNED YOU ARE ENTERING ENEMY TERRITORY)
app.command("/prevreports", async ({ command, ack, client }) => {
  await ack();
  try {
    // Member ID thingamagings
    let userId = command.text.trim();
    if (!userId.startsWith("<@") || !userId.endsWith(">")) {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: "Please use the @user format to specify a user.",
      });
    }

    // Extract the user ID from the <@user> format
    userId = userId.slice(2, -1).split("|")[0];

    // Get channel history (rahhhh this is like where it gets messyyy)
    const result = await client.conversations.history({
      channel: ALLOWED_CHANNELS[0],
      limit: 1000,
      latest: command.ts,
      inclusive: true,
    });

    // Filter msgs that mention the user
    const relevantMsgs = result.messages.filter((message) => {
      const hasMention = message.text.includes(`<@${userId}>`);
      return hasMention;
    });

    // If no messages found, send a notification (rn i get this)
    if (!relevantMsgs.length) {
      return await client.chat.postMessage({
        channel: command.channel_id,
        text: `No previous messages mentioning <@${userId}> found :(`,
      });
    }

    // Format messages w/ permalinks
    const msgsWithLinks = await Promise.all(
      relevantMsgs.slice(0, 10).map(async (msg) => {
        const permalinkResp = await client.chat.getPermalink({
          channel: ALLOWED_CHANNELS[0],
          message_ts: msg.ts,
        });

        // Format the timestamp (using british date format #ilovekilometers and celcius)
        const messageDate = new Date(parseFloat(msg.ts) * 1000);
        const formattedDate = messageDate.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const formattedTime = messageDate.toLocaleString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        const timestamp = `${formattedDate} at ${formattedTime}`;

        return {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Message from: ${timestamp}*\n${msg.text}\n<${permalinkResp.permalink}|View full message>`,
          },
        };
      })
    );

    const response = await client.chat.postMessage({
      channel: command.channel_id,
      text: `Messages mentioning <@${userId}>:`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `Messages mentioning <@${userId}>:`,
          },
        },
        ...msgsWithLinks,
      ],
      unfurl_links: false,
      unfurl_media: false,
    });

    // Delete the message after an hour
    setTimeout(async () => {
      try {
        await client.chat.delete({
          channel: command.channel_id,
          ts: response.ts,
        });
      } catch (error) {
        console.error(error);
      }
    }, 3600000);
  } catch (error) {
    console.error(error);
    await client.chat.postMessage({
      channel: command.channel_id,
      text: "Oopsie, eh I'll get to that!",
    });
  }
});

// Start the Slack bot
(async () => {
  await app.start();
  console.log("meow i think");
})();
