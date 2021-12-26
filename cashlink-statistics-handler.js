const { FullConsensusAgent } = require('@nimiq/core');

async function createStatistics(cashlinks, reclaimAddress, timeZone, rpcClient) {
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
    const claimsPerAddress = new Map(); // userfriendly address -> number
    const claimsPerDate = new Map(); // date string in format yyyy-mm-dd -> [claims, claims only counting first timers]

    const pendingPromises = new Set();
    for (const cashlink of cashlinks.values()) {
        const cashlinkAddress = cashlink.address;
        const cashlinkUserFriendlyAddress = cashlinkAddress.toUserFriendlyAddress();
        const statisticPromise = rpcClient.getTransactionsByAddress(cashlinkAddress).then((transactionObjects) => {
            // Not assuming cashlink has maximally one funding and claiming tx, as they can theoretically have multiple.
            let wasFunded = false;
            let wasUserClaimed = false;
            let wasReclaimed = false;

            for (const {toAddress, timestamp} of transactionObjects) {
                if (toAddress === cashlinkUserFriendlyAddress) {
                    wasFunded = true;
                } else if (toAddress === reclaimUserFriendlyAddress) {
                    wasReclaimed = true;
                } else {
                    wasUserClaimed = true;
                    const previousAddressClaims = claimsPerAddress.get(toAddress) || 0;
                    claimsPerAddress.set(toAddress, previousAddressClaims + 1);
                    const [{value: month},,{value: day},,{value: year}] = dateFormatter.formatToParts(timestamp * 1000);
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

        // throttled processing of cashlinks to avoid getting banned by network peers.
        if (processed < cashlinks.size) {
            await new Promise((resolve) => setTimeout(
                resolve,
                60000 / FullConsensusAgent.TRANSACTION_RECEIPTS_RATE_LIMIT + /* extra delay for safety */ 30,
            ));
        }
    }
    await Promise.all(pendingPromises);
    console.log(`Processed ${processed} Cashlinks.`);

    const repeatClaimers = [...claimsPerAddress]
        .filter(([, claims]) => claims > 1)
        .sort(([, claimsA], [, claimsB]) => claimsB - claimsA); // sort descending
    const claimsPerDateSorted = [...claimsPerDate]
        .sort(([dateA], [dateB]) => (dateA < dateB ? -1 : dateA > dateB ? 1 : 0)); // sort ascending
    const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
    return `Total Cashlinks: ${cashlinks.size}\n`
        + `Funded: ${funded} (${percentFormatter.format(funded / cashlinks.size)})\n`
        + `User claimed: ${userClaimed} (${percentFormatter.format(userClaimed / cashlinks.size)})\n`
        + `Unclaimed: ${unclaimed} (${percentFormatter.format(unclaimed / cashlinks.size)})\n`
        + `Reclaimed: ${reclaimed} (${percentFormatter.format(reclaimed / cashlinks.size)})\n`
        + (reclaimUserFriendlyAddress ? `Reclaimed to ${reclaimUserFriendlyAddress}\n` : '')
        + '\n'
        + `Distinct user addresses: ${claimsPerAddress.size} `
        + `(${percentFormatter.format(claimsPerAddress.size / (userClaimed || 1))} of user claimed Cashlinks, `
        + `${percentFormatter.format(claimsPerAddress.size / cashlinks.size)} of total Cashlinks)\n`
        + `Repeat claimers: ${repeatClaimers.length} `
        + `(${percentFormatter.format(repeatClaimers.length / (claimsPerAddress.size || 1))} of distinct users)\n`
        + repeatClaimers.map(([address, claims]) => `    ${address}: ${claims}\n`).join('')
        + '\n'
        + `User claims per day (${timeZone} timezone):\n`
        + claimsPerDateSorted.map(([date, [claims, claimsFirstTimers]]) => `    ${date}: ${claims}`
            + (claimsFirstTimers !== claims ? ` (${claimsFirstTimers} only counting first time claimers)` : '')
            + '\n').join('');
}

module.exports = { createStatistics };

