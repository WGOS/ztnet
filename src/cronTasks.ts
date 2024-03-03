import * as cron from "cron";
import { prisma } from "./server/db";
import * as ztController from "~/utils/ztApi";
import {
	fetchPeersForAllMembers,
	updateNetworkMembers,
} from "./server/api/services/networkService";
import { craftMemberFactory } from "./server/api/factory/memberFactory";

type FakeContext = {
	session: {
		user: {
			id: string;
		};
	};
};

export const CheckExpiredUsers = async () => {
	new cron.CronJob(
		// "*/10 * * * * *", // every 10 seconds ( testing )
		"0 0 0 * * *", // 12:00:00 AM (midnight) every day
		async () => {
			const expUsers = await prisma.user.findMany({
				where: {
					expiresAt: {
						lt: new Date(),
					},
					isActive: true,
					NOT: {
						role: "ADMIN",
					},
				},
				select: {
					network: true,
					id: true,
					role: true,
				},
			});

			// if no users return
			if (expUsers.length === 0) return;

			for (const userObj of expUsers) {
				if (userObj.role === "ADMIN") continue;

				const context: FakeContext = {
					session: {
						user: {
							id: userObj.id,
						},
					},
				};

				for (const network of userObj.network) {
					const members = await ztController.network_members(
						// @ts-ignore
						context,
						network.nwid,
						false,
					);
					for (const member in members) {
						const ctx = {
							session: {
								user: {
									id: userObj.id,
								},
							},
						};
						await ztController.member_update({
							// @ts-ignore
							ctx,
							nwid: network.nwid,
							central: false,
							memberId: member,
							updateParams: {
								authorized: false,
							},
						});
					}
				}

				// update user isActive to false
				await prisma.user.update({
					where: {
						id: userObj.id,
					},
					data: {
						isActive: false,
					},
				});
			}
		},
		null,
		true,
		"America/Los_Angeles",
	);
};

export const updatePeers = async () => {
	new cron.CronJob(
		// updates every 5 minutes

		"*/10 * * * * *", // every 10 seconds ( testing )
		// "*/5 * * * *", // every 5min
		async () => {
			try {
				// fetch all users
				const users = await prisma.user.findMany({
					where: {
						isActive: true,
					},
					select: {
						id: true,
					},
				});

				// if no users return
				if (users.length === 0) return;

				// fetch all members for each user
				for (const user of users) {
					const networks = await prisma.network.findMany({
						where: {
							authorId: user.id,
						},
						select: {
							nwid: true,
						},
					});

					// if no networks return
					if (networks.length === 0) return;

					// fetch all members for each network
					for (const network of networks) {
						const context: FakeContext = {
							session: {
								user: {
									id: user.id,
								},
							},
						};

						// get members from the zt controller
						const ztControllerResponse = await ztController.local_network_detail(
							// @ts-expect-error
							context,
							network.nwid,
							false,
						);
						if (!ztControllerResponse || !("members" in ztControllerResponse)) return;

						// fetch all peers for each member
						const peersForAllMembers = await fetchPeersForAllMembers(
							// @ts-expect-error
							context,
							ztControllerResponse.members,
						);

						const enrichedMembers = await craftMemberFactory(
							network.nwid,
							ztControllerResponse.members,
							peersForAllMembers,
						);
						// @ts-expect-error
						await updateNetworkMembers(context, enrichedMembers);
					}
				}
			} catch (error) {
				console.error("cron task updatePeers:", error);
			}
		},
		null,
		true,
		"America/Los_Angeles",
	);
};
