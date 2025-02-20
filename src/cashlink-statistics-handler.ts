/**
 * Nimiq Cashlink Statistics Handler
 * Generates detailed statistics for cashlink usage and claims.
 *
 * Features:
 * - Track funded and claimed cashlinks
 * - Monitor claiming patterns
 * - Generate per-day statistics
 * - Track unique claimers
 * - Support for reclaim address tracking
 *
 * The statistics handler provides detailed insights into cashlink usage patterns.
 */

import { type Address } from '@nimiq/core';
import { type Transaction as RpcTransaction } from '@blouflash/nimiq-rpc';
import { type RpcClient } from './rpc-client';
import { type Cashlink } from './cashlink';

/**
 * Creates comprehensive statistics for a set of cashlinks
 * @param cashlinks - Map of cashlinks to analyze
 * @param reclaimAddress - Optional address where cashlinks were reclaimed to
 * @param timeZone - Timezone for date-based statistics
 * @param rpcClient - RPC client for blockchain queries
 * @returns Formatted statistics string
 */
export async function createStatistics(
    cashlinks: Map<string, Cashlink>,
    reclaimAddress: Address | null,
    timeZone: string,
    rpcClient: RpcClient,
): Promise<string> {
    const reclaimUserFriendlyAddress = reclaimAddress ? reclaimAddress.toUserFriendlyAddress() : null;
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    // Note that for reused cashlinks, these values might sum up to higher values than the cashlink count.
    let processed = 0;
    let funded = 0;
    let userClaimed = 0;
    let reclaimed = 0;
    let unclaimed = 0;
    // Map userfriendly address -> number
    const claimsPerAddress = new Map<string, number>();
    // Map date string in format yyyy-mm-dd -> [claims, claims only counting first timers]
    const claimsPerDate = new Map<string, [number, number]>();

    const pendingPromises = new Set<Promise<void>>();
    for (const cashlink of cashlinks.values()) {
        const cashlinkAddress = cashlink.address;
        const cashlinkUserFriendlyAddress = cashlinkAddress.toUserFriendlyAddress();
        const statisticPromise = rpcClient.getTransactionsByAddress(cashlinkUserFriendlyAddress)
            .then((transactionObjects: RpcTransaction[]) => {
                // Not assuming cashlink has maximally one funding and claiming tx. They can theoretically have multiple
                let wasFunded = false;
                let wasUserClaimed = false;
                let wasReclaimed = false;

                for (const tx of transactionObjects) {
                    const { to: recipient, timestamp } = tx;
                    if (!timestamp) continue; // not yet included in a block

                    if (recipient === cashlinkUserFriendlyAddress) {
                        wasFunded = true;
                    } else if (recipient === reclaimUserFriendlyAddress) {
                        wasReclaimed = true;
                    } else {
                        wasUserClaimed = true;
                        const previousAddressClaims = claimsPerAddress.get(recipient) || 0;
                        claimsPerAddress.set(recipient, previousAddressClaims + 1);
                        const [
                            { value: month },,
                            { value: day },,
                            { value: year },
                        ] = dateFormatter.formatToParts(Number(timestamp) * 1000);
                        const date = `${year}-${month}-${day}`; // lexically sortable
                        const [previousDateClaims, previousDateClaimsFirstTimers] = claimsPerDate.get(date) || [0, 0];
                        claimsPerDate.set(date, [
                            previousDateClaims + 1,
                            previousDateClaimsFirstTimers + (!previousAddressClaims ? 1 : 0),
                        ]);
                    }
                }

                processed++;
                if (wasFunded) funded++;
                if (wasUserClaimed) userClaimed++;
                if (wasReclaimed) reclaimed++;
                if (wasFunded && !wasUserClaimed && !wasReclaimed) unclaimed++;

                if (processed !== cashlinks.size && processed % Math.ceil(cashlinks.size / 10) === 0) {
                    console.log(`Processed ${processed} Cashlinks so far.`);
                }

                pendingPromises.delete(statisticPromise);
            });
        pendingPromises.add(statisticPromise);
    }
    await Promise.all(pendingPromises);
    console.log(`Processed ${processed} Cashlinks.`);

    const repeatClaimers = [...claimsPerAddress.entries()]
        .filter(([, claims]) => claims > 1)
        .sort(([, claimsA], [, claimsB]) => claimsB - claimsA); // sort descending

    const claimsPerDateSorted = [...claimsPerDate.entries()]
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB)); // sort ascending

    const percentFormatter = new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: 2,
    });

    return formatStatistics(
        cashlinks.size,
        funded,
        userClaimed,
        unclaimed,
        reclaimed,
        reclaimUserFriendlyAddress,
        claimsPerAddress,
        repeatClaimers,
        claimsPerDateSorted,
        percentFormatter,
        timeZone,
    );
}

/**
 * Formats statistics into a human-readable string
 * @param totalCashlinks - Total number of cashlinks
 * @param funded - Number of funded cashlinks
 * @param userClaimed - Number of user-claimed cashlinks
 * @param unclaimed - Number of unclaimed cashlinks
 * @param reclaimed - Number of reclaimed cashlinks
 * @param reclaimUserFriendlyAddress - Address used for reclaiming
 * @param claimsPerAddress - Map of addresses to claim counts
 * @param repeatClaimers - Array of addresses that claimed multiple times
 * @param claimsPerDateSorted - Array of daily claim statistics
 * @param percentFormatter - Formatter for percentage values
 * @param timeZone - Timezone used for statistics
 * @returns Formatted statistics string
 */
function formatStatistics(
    totalCashlinks: number,
    funded: number,
    userClaimed: number,
    unclaimed: number,
    reclaimed: number,
    reclaimUserFriendlyAddress: string | null,
    claimsPerAddress: Map<string, number>,
    repeatClaimers: [string, number][],
    claimsPerDateSorted: [string, [number, number]][],
    percentFormatter: Intl.NumberFormat,
    timeZone: string,
): string {
    return `Total Cashlinks: ${totalCashlinks}\n`
        + `Funded: ${funded} (${percentFormatter.format(funded / totalCashlinks)})\n`
        + `User claimed: ${userClaimed} (${percentFormatter.format(userClaimed / totalCashlinks)})\n`
        + `Unclaimed: ${unclaimed} (${percentFormatter.format(unclaimed / totalCashlinks)})\n`
        + `Reclaimed: ${reclaimed} (${percentFormatter.format(reclaimed / totalCashlinks)})\n`
        + (reclaimUserFriendlyAddress ? `Reclaimed to ${reclaimUserFriendlyAddress}\n` : '')
        + '\n'
        + `Distinct user addresses: ${claimsPerAddress.size} `
        + `(${percentFormatter.format(claimsPerAddress.size / (userClaimed || 1))} of user claimed Cashlinks, `
        + `${percentFormatter.format(claimsPerAddress.size / totalCashlinks)} of total Cashlinks)\n`
        + `Repeat claimers: ${repeatClaimers.length} `
        + `(${percentFormatter.format(repeatClaimers.length / (claimsPerAddress.size || 1))} of distinct users)\n`
        + repeatClaimers.map(([address, claims]) => `    ${address}: ${claims}\n`).join('')
        + '\n'
        + `User claims per day (${timeZone} timezone):\n`
        + claimsPerDateSorted.map(([date, [claims, claimsFirstTimers]]) =>
            `    ${date}: ${claims}${claimsFirstTimers !== claims 
                ? ` (${claimsFirstTimers} only counting first time claimers)` 
                : ''}\n`,
        ).join('');
}
