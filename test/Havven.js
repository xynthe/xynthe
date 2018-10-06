const ExchangeRates = artifacts.require('ExchangeRates');
const Havven = artifacts.require('Havven');
const Nomin = artifacts.require('Nomin');

const {
	assertBNClose,
	currentTime,
	fastForward,
	multiplyDecimal,
	divideDecimal,
	fromUnit,
	toUnit,
	ZERO_ADDRESS,
} = require('../utils/testUtils');

contract.only('Havven', async function(accounts) {
	const [nUSD, nAUD, nEUR, HAV, HDR, nXYZ] = ['nUSD', 'nAUD', 'nEUR', 'HAV', 'HDR', 'nXYZ'].map(
		web3.utils.asciiToHex
	);

	const [deployerAccount, owner, account1, account2, account3, account4] = accounts;

	let havven, exchangeRates, nUSDContract;

	beforeEach(async function() {
		// Save ourselves from having to await deployed() in every single test.
		// We do this in a beforeEach instead of before to ensure we isolate
		// contract interfaces to prevent test bleed.
		exchangeRates = await ExchangeRates.deployed();

		havven = await Havven.deployed();
		nUSDContract = await Nomin.at(await havven.nomins(nUSD));

		// Send a price update to guarantee we're not stale.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{
				from: oracle,
			}
		);
	});

	it('should set constructor params on deployment', async function() {
		const instance = await Havven.new(account1, account2, account3, account4, ZERO_ADDRESS, {
			from: deployerAccount,
		});

		assert.equal(await instance.proxy(), account1);
		assert.equal(await instance.tokenState(), account2);
		assert.equal(await instance.owner(), account3);
		assert.equal(await instance.exchangeRates(), account4);
	});

	it('should correctly upgrade from the previous nUSD contract deployment');

	it('should allow adding a Nomin contract', async function() {
		const previousNominCount = await havven.availableNominCount();

		const nomin = await Nomin.new(
			account1,
			account2,
			Havven.address,
			'Nomin XYZ',
			'nXYZ',
			owner,
			web3.utils.asciiToHex('nXYZ'),
			{ from: deployerAccount }
		);

		await havven.addNomin(nomin.address, { from: owner });

		// Assert that we've successfully added a Nomin
		assert.bnEqual(await havven.availableNominCount(), previousNominCount.add(web3.utils.toBN(1)));
		// Assert that it's at the end of the array
		assert.equal(await havven.availableNomins(previousNominCount), nomin.address);
		// Assert that it's retrievable by its currencyKey
		assert.equal(await havven.nomins(web3.utils.asciiToHex('nXYZ')), nomin.address);
	});

	it('should disallow adding a Nomin contract when the user is not the owner', async function() {
		const nomin = await Nomin.new(
			account1,
			account2,
			Havven.address,
			'Nomin XYZ',
			'nXYZ',
			owner,
			web3.utils.asciiToHex('nXYZ'),
			{ from: deployerAccount }
		);

		await assert.revert(havven.addNomin(nomin.address, { from: account1 }));
	});

	it('should disallow double adding a Nomin contract with the same address', async function() {
		const nomin = await Nomin.new(
			account1,
			account2,
			Havven.address,
			'Nomin XYZ',
			'nXYZ',
			owner,
			web3.utils.asciiToHex('nXYZ'),
			{ from: deployerAccount }
		);

		await havven.addNomin(nomin.address, { from: owner });
		await assert.revert(havven.addNomin(nomin.address, { from: owner }));
	});

	it('should disallow double adding a Nomin contract with the same currencyKey', async function() {
		const nomin1 = await Nomin.new(
			account1,
			account2,
			Havven.address,
			'Nomin XYZ',
			'nXYZ',
			owner,
			web3.utils.asciiToHex('nXYZ'),
			{ from: deployerAccount }
		);

		const nomin2 = await Nomin.new(
			account1,
			account2,
			Havven.address,
			'Nomin XYZ',
			'nXYZ',
			owner,
			web3.utils.asciiToHex('nXYZ'),
			{ from: deployerAccount }
		);

		await havven.addNomin(nomin1.address, { from: owner });
		await assert.revert(havven.addNomin(nomin2.address, { from: owner }));
	});

	it('should allow removing a Nomin contract when it has no issued balance', async function() {
		// Note: This test depends on state in the migration script, that there are hooked up nomins
		// without balances and we just remove one.
		const nomin = await Nomin.at(await havven.availableNomins(0));
		const currencyKey = await nomin.currencyKey();
		const nominCount = await havven.availableNominCount();

		assert.notEqual(await havven.nomins(currencyKey), ZERO_ADDRESS);

		await havven.removeNomin(currencyKey, { from: owner });

		// Assert that we have one less nomin, and that the specific currency key is gone.
		assert.bnEqual(await havven.availableNominCount(), nominCount.sub(web3.utils.toBN(1)));
		assert.equal(await havven.nomins(currencyKey), ZERO_ADDRESS);

		// TODO: Check that an event was successfully fired ?
	});

	it('should disallow removing a Nomin contract when it has an issued balance', async function() {
		// Note: This test depends on state in the migration script, that there are hooked up nomins
		// without balances
		const nUSDContractAddress = await havven.nomins(nUSD);

		// Assert that we can remove the nomin and add it back in before we do anything.
		let transaction = await havven.removeNomin(nUSD, { from: owner });
		assert.eventEqual(transaction, 'NominRemoved', {
			currencyKey: nUSD,
			removedNomin: nUSDContractAddress,
		});
		transaction = await havven.addNomin(nUSDContractAddress, { from: owner });
		assert.eventEqual(transaction, 'NominAdded', {
			currencyKey: nUSD,
			newNomin: nUSDContractAddress,
		});

		// Issue one nUSD
		await havven.issueNomins(nUSD, toUnit('1'), { from: owner });

		// Assert that we can't remove the nomin now
		await assert.revert(havven.removeNomin(nUSD, { from: owner }));
	});

	it('should disallow removing a Nomin contract when requested by a non-owner', async function() {
		// Note: This test depends on state in the migration script, that there are hooked up nomins
		// without balances
		await assert.revert(havven.removeNomin(nEUR, { from: account1 }));
	});

	it('should revert when requesting to remove a non-existent nomin', async function() {
		// Note: This test depends on state in the migration script, that there are hooked up nomins
		// without balances
		const currencyKey = web3.utils.asciiToHex('NOPE');

		// Assert that we can't remove the nomin
		await assert.revert(havven.removeNomin(currencyKey, { from: owner }));
	});

	it('should allow the owner to set an Escrow contract', async function() {
		const transaction = await havven.setEscrow(account1, { from: owner });

		assert.eventEqual(transaction, 'EscrowUpdated', { newEscrow: account1 });
	});

	it('should disallow a non-owner from setting an Escrow contract', async function() {
		await assert.revert(havven.setEscrow(account1, { from: account1 }));
	});

	it('should allow the owner to set fee period duration', async function() {
		// Set fee period to 5 days
		const duration = 5 * 24 * 60 * 60;
		const transaction = await havven.setFeePeriodDuration(web3.utils.toBN(duration), {
			from: owner,
		});

		assert.eventEqual(transaction, 'FeePeriodDurationUpdated', { duration });
	});

	it('should disallow a non-owner from setting the fee period duration', async function() {
		// Try to set fee period to 5 days
		const duration = 5 * 24 * 60 * 60;
		await assert.revert(
			havven.setFeePeriodDuration(web3.utils.toBN(duration), {
				from: account1,
			})
		);
	});

	it('should disallow setting the fee period duration below the minimum fee period duration', async function() {
		// Minimum is currently 1 day in the contract
		const minimum = 60 * 60 * 24;

		// Setting to the minimum should succeed
		const transaction = await havven.setFeePeriodDuration(web3.utils.toBN(minimum), {
			from: owner,
		});
		assert.eventEqual(transaction, 'FeePeriodDurationUpdated', { duration: minimum });

		// While setting to minimum - 1 should fail
		await assert.revert(
			havven.setFeePeriodDuration(web3.utils.toBN(minimum - 1), {
				from: owner,
			})
		);
	});

	it('should disallow setting the fee period duration above the maximum fee period duration', async function() {
		// Maximum is currently 26 weeks in the contract
		const maximum = 60 * 60 * 24 * 7 * 26;

		// Setting to the maximum should succeed
		const transaction = await havven.setFeePeriodDuration(web3.utils.toBN(maximum), {
			from: owner,
		});
		assert.eventEqual(transaction, 'FeePeriodDurationUpdated', { duration: maximum });

		// While setting to maximum + 1 should fail
		await assert.revert(
			havven.setFeePeriodDuration(web3.utils.toBN(maximum + 1), {
				from: owner,
			})
		);
	});

	it('should allow the owner to set an Exchange Rates contract', async function() {
		const transaction = await havven.setExchangeRates(account1, { from: owner });

		assert.eventEqual(transaction, 'ExchangeRatesUpdated', { newExchangeRates: account1 });
	});

	it('should disallow a non-owner from setting an Exchange Rates contract', async function() {
		await assert.revert(havven.setExchangeRates(account1, { from: account1 }));
	});

	it('should allow the owner to set the issuance ratio', async function() {
		const ratio = toUnit('0.2');

		const transaction = await havven.setIssuanceRatio(ratio, {
			from: owner,
		});

		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: ratio });
	});

	it('should allow the owner to set the issuance ratio to zero', async function() {
		const ratio = web3.utils.toBN('0');

		const transaction = await havven.setIssuanceRatio(ratio, {
			from: owner,
		});

		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: ratio });
	});

	it('should disallow a non-owner from setting the issuance ratio', async function() {
		const ratio = toUnit('0.2');

		await assert.revert(
			havven.setIssuanceRatio(ratio, {
				from: account1,
			})
		);
	});

	it('should disallow setting the issuance ratio above the MAX ratio', async function() {
		const max = toUnit('1');

		// It should succeed when setting it to max
		const transaction = await havven.setIssuanceRatio(max, {
			from: owner,
		});
		assert.eventEqual(transaction, 'IssuanceRatioUpdated', { newRatio: max });

		// But max + 1 should fail
		await assert.revert(
			havven.setIssuanceRatio(web3.utils.toBN(max).add(web3.utils.toBN('1')), {
				from: account1,
			})
		);
	});

	it('should allow the owner to add someone as a whitelisted issuer', async function() {
		assert.equal(await havven.isIssuer(account1), false);

		const transaction = await havven.setIssuer(account1, true, { from: owner });
		assert.eventEqual(transaction, 'IssuerUpdated', { account: account1, value: true });

		assert.equal(await havven.isIssuer(account1), true);
	});

	it('should disallow a non-owner from adding someone as a whitelisted issuer', async function() {
		assert.equal(await havven.isIssuer(account1), false);

		await assert.revert(havven.setIssuer(account1, true, { from: account1 }));
	});

	it('should correctly calculate an exchange rate in effectiveValue()', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// 1 nUSD should be worth 2 nAUD.
		assert.bnEqual(await havven.effectiveValue(nUSD, toUnit('1'), nAUD), toUnit('2'));

		// 10 HAV should be worth 1 nUSD.
		assert.bnEqual(await havven.effectiveValue(HAV, toUnit('10'), nUSD), toUnit('1'));

		// 2 nEUR should be worth 2.50 nUSD
		assert.bnEqual(await havven.effectiveValue(nEUR, toUnit('2'), nUSD), toUnit('2.5'));
	});

	it('should error when relying on a stale exchange rate in effectiveValue()', async function() {
		// Send a price update so we know what time we started with.
		const oracle = await exchangeRates.oracle();
		let timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Add stale period to the time to ensure we go stale.
		await fastForward(await exchangeRates.rateStalePeriod());

		timestamp = await currentTime();

		// Update all rates except nUSD.
		await exchangeRates.updateRates(
			[nAUD, nEUR, HAV],
			['0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Should now be able to convert from HAV to nAUD
		assert.bnEqual(await havven.effectiveValue(HAV, toUnit('10'), nAUD), toUnit('2'));

		// But trying to convert from HAV to nUSD should fail
		await assert.revert(havven.effectiveValue(HAV, toUnit('10'), nUSD));
		await assert.revert(havven.effectiveValue(nUSD, toUnit('10'), HAV));
	});

	it('should revert when relying on a non-existant exchange rate in effectiveValue()', async function() {
		// Send a price update so we know what time we started with.
		const oracle = await exchangeRates.oracle();
		let timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		await assert.revert(havven.effectiveValue(HAV, toUnit('10'), web3.utils.asciiToHex('XYZ')));
	});

	it('should correctly calculate the total issued nomins in a single currency', async function() {
		// Two people issue 10 nUSD each. Assert that total issued value is 20 nUSD.

		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1 and account2
		await havven.transfer(account1, toUnit('1000'), { from: owner });
		await havven.transfer(account2, toUnit('1000'), { from: owner });

		// Make them issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue 10 nUSD each
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nUSD, toUnit('10'), { from: account2 });

		// Assert that there's 20 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('20'));
	});

	it('should correctly calculate the total issued nomins in multiple currencies', async function() {
		// Alice issues 10 nUSD. Bob issues 20 nAUD. Assert that total issued value is 20 nUSD, and 40 nAUD.

		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1 and account2
		await havven.transfer(account1, toUnit('1000'), { from: owner });
		await havven.transfer(account2, toUnit('1000'), { from: owner });

		// Make them issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue 10 nUSD each
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nAUD, toUnit('20'), { from: account2 });

		// Assert that there's 20 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('20'));

		// And that there's 40 nAUD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nAUD), toUnit('40'));
	});

	it('should transfer using the ERC20 transfer function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		const transaction = await havven.transfer(account1, toUnit('10'), { from: owner });
		assert.eventEqual(transaction, 'Transfer', {
			from: owner,
			to: account1,
			value: toUnit('10'),
		});

		assert.bnEqual(await havven.balanceOf(account1), toUnit('10'));
	});

	it('should revert when exceeding locked havvens and calling the ERC20 transfer function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		// Issue max nomins.
		await havven.issueMaxNomins(nUSD, { from: owner });

		// Try to transfer 0.000000000000000001 HAV
		await assert.revert(havven.transfer(account1, '1', { from: owner }));
	});

	it('should transfer using the ERC20 transferFrom function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		const previousOwnerBalance = await havven.balanceOf(owner);
		assert.bnEqual(await havven.totalSupply(), previousOwnerBalance);

		// Approve account1 to act on our behalf for 10 HAV.
		let transaction = await havven.approve(account1, toUnit('10'), { from: owner });
		assert.eventEqual(transaction, 'Approval', {
			owner,
			spender: account1,
			value: toUnit('10'),
		});

		// Assert that transferFrom works.
		transaction = await havven.transferFrom(owner, account2, toUnit('10'), { from: account1 });
		assert.eventEqual(transaction, 'Transfer', {
			from: owner,
			to: account2,
			value: toUnit('10'),
		});

		// Assert that account2 has 10 HAV and owner has 10 less HAV
		assert.bnEqual(await havven.balanceOf(account2), toUnit('10'));
		assert.bnEqual(await havven.balanceOf(owner), previousOwnerBalance.sub(toUnit('10')));

		// Assert that we can't transfer more even though there's a balance for owner.
		await assert.revert(havven.transferFrom(owner, account2, '1', { from: account1 }));
	});

	it('should revert when exceeding locked havvens and calling the ERC20 transferFrom function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Approve account1 to act on our behalf for 10 HAV.
		let transaction = await havven.approve(account1, toUnit('10'), { from: owner });
		assert.eventEqual(transaction, 'Approval', {
			owner,
			spender: account1,
			value: toUnit('10'),
		});

		// Issue max nomins
		await havven.issueMaxNomins(nUSD, { from: owner });

		// Assert that transferFrom fails even for the smallest amount of HAV.
		await assert.revert(havven.transferFrom(owner, account2, '1', { from: account1 }));
	});

	it('should transfer using the ERC223 transfer function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		const transaction = await havven.transfer(
			account1,
			toUnit('10'),
			web3.utils.asciiToHex('This is a memo'),
			{ from: owner }
		);

		// Note, this is an ERC20 event, not ERC223 to maintain backwards compatibility with
		// tools that expect ERC20 events, since solidity does not support event overloading.
		assert.eventEqual(transaction, 'Transfer', {
			from: owner,
			to: account1,
			value: toUnit('10'),
		});

		assert.bnEqual(await havven.balanceOf(account1), toUnit('10'));
	});

	it('should revert when exceeding locked havvens and calling the ERC223 transfer function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		// Issue max nomins.
		await havven.issueMaxNomins(nUSD, { from: owner });

		// Try to transfer 0.000000000000000001 HAV
		await assert.revert(
			havven.transfer(account1, '1', web3.utils.asciiToHex('This is a memo'), { from: owner })
		);
	});

	it('should transfer using the ERC223 transferFrom function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		const previousOwnerBalance = await havven.balanceOf(owner);
		assert.bnEqual(await havven.totalSupply(), previousOwnerBalance);

		// Approve account1 to act on our behalf for 10 HAV.
		let transaction = await havven.approve(account1, toUnit('10'), { from: owner });
		assert.eventEqual(transaction, 'Approval', {
			owner,
			spender: account1,
			value: toUnit('10'),
		});

		// Assert that transferFrom works.
		transaction = await havven.transferFrom(
			owner,
			account2,
			toUnit('10'),
			web3.utils.asciiToHex('This is a memo'),
			{ from: account1 }
		);
		assert.eventEqual(transaction, 'Transfer', {
			from: owner,
			to: account2,
			value: toUnit('10'),
		});

		// Assert that account2 has 10 HAV and owner has 10 less HAV
		assert.bnEqual(await havven.balanceOf(account2), toUnit('10'));
		assert.bnEqual(await havven.balanceOf(owner), previousOwnerBalance.sub(toUnit('10')));

		// Assert that we can't transfer more even though there's a balance for owner.
		await assert.revert(havven.transferFrom(owner, account2, '1', { from: account1 }));
	});

	it('should revert when exceeding locked havvens and calling the ERC223 transferFrom function', async function() {
		// Ensure our environment is set up correctly for our assumptions
		// e.g. owner owns all HAV.
		assert.bnEqual(await havven.totalSupply(), await havven.balanceOf(owner));

		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Approve account1 to act on our behalf for 10 HAV.
		let transaction = await havven.approve(account1, toUnit('10'), { from: owner });
		assert.eventEqual(transaction, 'Approval', {
			owner,
			spender: account1,
			value: toUnit('10'),
		});

		// Issue max nomins
		await havven.issueMaxNomins(nUSD, { from: owner });

		// Assert that transferFrom fails even for the smallest amount of HAV.
		await assert.revert(
			havven.transferFrom(owner, account2, '1', web3.utils.asciiToHex('This is a memo'), {
				from: account1,
			})
		);
	});

	it('should allow a whitelisted issuer to issue nomins in one flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('1000'), { from: owner });

		// Make account1 an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// account1 should be able to issue
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });

		// There should be 10 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('10'));

		// And account1 should own 100% of the debt.
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('10'));
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('10'));
	});

	it('should allow a whitelisted issuer to issue nomins in multiple flavours', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('1000'), { from: owner });

		// Make account1 an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// account1 should be able to issue nUSD and nAUD
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nAUD, toUnit('20'), { from: account1 });

		// There should be 20 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('20'));
		// Which equals 40 nAUD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nAUD), toUnit('40'));

		// And account1 should own 100% of the debt.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('20'));
		assert.bnEqual(await havven.debtBalanceOf(account1, nAUD), toUnit('40'));
	});

	it('should allow two issuers to issue nomins in one flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1 and account2
		await havven.transfer(account1, toUnit('10000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nUSD, toUnit('20'), { from: account2 });

		// There should be 30nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('30'));

		// And the debt should be split 50/50.
		// But there's a small rounding error.
		// This is ok, as when the last person exits the system, their debt percentage is always 100% so
		// these rounding errors don't cause the system to be out of balance.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('10.00000000000000002'));
		assert.bnEqual(await havven.debtBalanceOf(account2, nUSD), toUnit('19.99999999999999998'));
	});

	it('should allow multi-issuance in one flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1 and account2
		await havven.transfer(account1, toUnit('10000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nUSD, toUnit('20'), { from: account2 });
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });

		// There should be 40 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('40'));

		// And the debt should be split 50/50.
		// But there's a small rounding error.
		// This is ok, as when the last person exits the system, their debt percentage is always 100% so
		// these rounding errors don't cause the system to be out of balance.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('20'));
		assert.bnEqual(await havven.debtBalanceOf(account2, nUSD), toUnit('19.99999999999999992'));
	});

	it('should allow multiple issuers to issue nomins in multiple flavours', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1 and account2
		await havven.transfer(account1, toUnit('10000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nAUD, toUnit('20'), { from: account2 });

		// There should be 20 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('20'));

		// And the debt should be split 50/50.
		// But there's a small rounding error.
		// This is ok, as when the last person exits the system, their debt percentage is always 100% so
		// these rounding errors don't cause the system to be out of balance.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('10'));
		assert.bnEqual(await havven.debtBalanceOf(account2, nUSD), toUnit('10'));
	});

	it('should allow a whitelisted issuer to issue max nomins in one flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		await havven.issueMaxNomins(nUSD, { from: account1 });

		// There should be 200 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('200'));

		// And account1 should own all of it.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('200'));
	});

	it('should allow a whitelisted issuer to issue max nomins via the standard issue call', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Determine maximum amount that can be issued.
		const maxIssuable = await havven.maxIssuableNomins(account1, nUSD);

		// Issue
		await havven.issueNomins(nUSD, maxIssuable, { from: account1 });

		// There should be 200 nUSD of value in the system
		assert.bnEqual(await havven.totalIssuedNomins(nUSD), toUnit('200'));

		// And account1 should own all of it.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('200'));
	});

	it('should report that a non-whitelisted user has zero maxIssuableNomins', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// They should have no issuable nomins.
		assert.bnEqual(await havven.maxIssuableNomins(account1, nUSD), '0');

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// They should now be able to issue 200 nUSD
		assert.bnEqual(await havven.maxIssuableNomins(account1, nUSD), toUnit('200'));
	});

	it('should disallow a non-whitelisted issuer from issuing nomins in a single flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// They should not be able to issue because they aren't whitelisted.
		await assert.revert(havven.issueNomins(nUSD, toUnit('10'), { from: account1 }));

		// To just double check that that was the actual limitation that caused the revert, let's
		// assert that they're able to issue after whitelisting.
		await havven.setIssuer(account1, true, { from: owner });

		// They should now be able to issue nUSD
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
	});

	it('should disallow a whitelisted issuer from issuing nomins in a non-existant flavour', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Set them as an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// They should now be able to issue nUSD
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });

		// But should not be able to issue nXYZ because it doesn't exist
		await assert.revert(havven.issueNomins(nXYZ, toUnit('10')));
	});

	it('should disallow a whitelisted issuer from issuing nomins beyond their remainingIssuableNomins', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Set them as an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// They should now be able to issue nUSD
		const issuableNomins = await havven.remainingIssuableNomins(account1, nUSD);
		assert.bnEqual(issuableNomins, toUnit('200'));

		// Issue that amount.
		await havven.issueNomins(nUSD, issuableNomins, { from: account1 });

		// They should now have 0 issuable nomins.
		assert.bnEqual(await havven.remainingIssuableNomins(account1, nUSD), '0');

		// And trying to issue the smallest possible unit of one should fail.
		await assert.revert(havven.issueNomins(nUSD, '1', { from: account1 }));
	});

	it('should allow an issuer with outstanding debt to burn nomins and forgive debt', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		await havven.issueMaxNomins(nUSD, { from: account1 });

		// account1 should now have 200 nUSD of debt.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('200'));

		// Burn 100 nUSD
		await havven.burnNomins(nUSD, toUnit('100'), { from: account1 });

		// account1 should now have 100 nUSD of debt.
		assert.bnEqual(await havven.debtBalanceOf(account1, nUSD), toUnit('100'));
	});

	it('should disallow an issuer without outstanding debt from burning nomins', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		await havven.issueMaxNomins(nUSD, { from: account1 });

		// account2 should not have anything and can't burn.
		await assert.revert(havven.burnNomins(nUSD, toUnit('10'), { from: account2 }));

		// And even when we give account2 nomins, it should not be able to burn.
		await nUSDContract.transfer(account2, toUnit('100'), { from: account1 });
		await assert.revert(havven.burnNomins(nUSD, toUnit('10'), { from: account2 }));
	});

	it('should fail when trying to burn nomins that do not exist', async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		await havven.issueMaxNomins(nUSD, { from: account1 });

		// Transfer all newly issued nomins to account2
		await nUSDContract.transfer(account2, toUnit('200'), { from: account1 });

		// Burning any amount of nUSD from account1 should fail
		await assert.revert(havven.burnNomins(nUSD, '1', { from: account1 }));
	});

	it("should only burn up to a user's actual debt level", async function() {
		// Send a price update to guarantee we're not depending on values from outside this test.
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR, HAV],
			['1', '0.5', '1.25', '0.1'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// Give some HAV to account1
		await havven.transfer(account1, toUnit('10000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		// Make account an issuer
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		await havven.issueNomins(nUSD, toUnit('10'), { from: account1 });
		await havven.issueNomins(nUSD, toUnit('200'), { from: account2 });

		// Transfer all of account2's nomins to account1
		await nUSDContract.transfer(account1, toUnit('200'), { from: account2 });

		// Then try to burn them all. Only 10 nomins (and fees) should be gone, but there is a slight rounding error on the calculation.
		await havven.burnNomins(nUSD, await nUSDContract.balanceOf(account1), { from: account1 });

		assert.bnEqual(await nUSDContract.balanceOf(account1), toUnit('199.700449326010983324'));
	});

	it.only('should correctly calculate debt in a multi-issuance scenario', async function() {
		// Give some HAV to account1
		await havven.transfer(account1, toUnit('200000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		const issuedNominsPt1 = toUnit('2000');
		const issuedNominsPt2 = toUnit('10');
		await havven.issueNomins(nUSD, issuedNominsPt1, { from: account1 });
		await havven.issueNomins(nUSD, issuedNominsPt2, { from: account1 });
		await havven.issueNomins(nUSD, toUnit('200'), { from: account2 });

		const debt = await havven.debtBalanceOf(account1, web3.utils.asciiToHex('nUSD'));

		// TODO: Check with Kevin how this is supposed to work
		assertBNClose(debt, issuedNominsPt1.add(issuedNominsPt2));
	});

	it.only('should correctly calculate debt in a multi-issuance multi-burn scenario', async function() {
		// Give some HAV to account1
		await havven.transfer(account1, toUnit('500000'), { from: owner });
		await havven.transfer(account2, toUnit('14000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });
		await havven.setIssuer(account2, true, { from: owner });

		// Issue
		const issuedNominsPt1 = toUnit('2000');
		const burntNominsPt1 = toUnit('1500');
		const issuedNominsPt2 = toUnit('1600');
		const burntNominsPt2 = toUnit('500');

		await havven.issueNomins(nUSD, issuedNominsPt1, { from: account1 });
		await havven.burnNomins(nUSD, burntNominsPt1, { from: account1 });
		await havven.issueNomins(nUSD, issuedNominsPt2, { from: account1 });

		// const maxIssuableNomins = await havven.maxIssuableNomins(account2, nUSD);
		// console.log('##### maxIssuableNomins: ', fromUnit(maxIssuableNomins).toString());

		await havven.issueNomins(nUSD, toUnit('200'), { from: account2 });
		await havven.issueNomins(nUSD, toUnit('51'), { from: account2 });
		await havven.burnNomins(nUSD, burntNominsPt2, { from: account1 });

		const debt = await havven.debtBalanceOf(account1, web3.utils.asciiToHex('nUSD'));
		const expectedDebt = issuedNominsPt1
			.add(issuedNominsPt2)
			.sub(burntNominsPt1)
			.sub(burntNominsPt2);

		console.log('##### debt: ', debt.toString());
		console.log('##### expectedDebt: ', expectedDebt.toString());

		// TODO: Check with Kevin how this is supposed to work
		assertBNClose(debt, expectedDebt, '10000');
	});

	it("should correctly calculate a user's maximum issuable nomins without prior issuance", async function() {
		const rate = await exchangeRates.rateForCurrency(web3.utils.asciiToHex('HAV'));
		const issuedHavvens = web3.utils.toBN('200000');
		await havven.transfer(account1, toUnit(issuedHavvens), { from: owner });
		await havven.setIssuer(account1, true, { from: owner });
		const issuanceRatio = await havven.issuanceRatio.call();

		const expectedIssuableNomins = multiplyDecimal(
			toUnit(issuedHavvens),
			multiplyDecimal(rate, issuanceRatio)
		);
		const maxIssuableNomins = await havven.maxIssuableNomins(account1, nUSD);

		assert.bnEqual(expectedIssuableNomins, maxIssuableNomins);
	});

	it("should correctly calculate a user's maximum issuable nomins without any havens", async function() {
		const maxIssuableNomins = await havven.maxIssuableNomins(account1, nEUR);
		assert.bnEqual(0, maxIssuableNomins);
	});

	it("should correctly calculate a user's maximum issuable nomins with prior issuance", async function() {
		const hav2usdRate = await exchangeRates.rateForCurrency(HAV);
		const aud2usdRate = await exchangeRates.rateForCurrency(nAUD);
		const hav2audRate = divideDecimal(hav2usdRate, aud2usdRate);

		const issuedHavvens = web3.utils.toBN('320001');
		await havven.transfer(account1, toUnit(issuedHavvens), { from: owner });
		await havven.setIssuer(account1, true, { from: owner });

		const issuanceRatio = await havven.issuanceRatio.call();
		const nAUDIssued = web3.utils.toBN('1234');
		await havven.issueNomins(nAUD, toUnit(nAUDIssued), { from: account1 });

		const expectedIssuableNomins = multiplyDecimal(
			toUnit(issuedHavvens),
			multiplyDecimal(hav2audRate, issuanceRatio)
		);

		const maxIssuableNomins = await havven.maxIssuableNomins(account1, nAUD);
		assert.bnEqual(expectedIssuableNomins, maxIssuableNomins);
	});

	it('should error when calculating maximum issuance when the HAV rate is stale', async function() {
		// Add stale period to the time to ensure we go stale.
		await fastForward(await exchangeRates.rateStalePeriod());
		const oracle = await exchangeRates.oracle();
		const timestamp = await currentTime();

		await exchangeRates.updateRates(
			[nUSD, nAUD, nEUR],
			['1', '0.5', '1.25'].map(toUnit),
			timestamp,
			{ from: oracle }
		);

		// assert.revert(havven.maxIssuableNomins(account1, nAUD));

		//
		// ????? What the heck is going on here!?
		// Why doesn't assertRevert work?

		let errorCaught = false;
		try {
			await havven.maxIssuableNomins(account1, nAUD);
		} catch (error) {
			assert.include(error.message, 'revert');
			errorCaught = true;
		}
		assert.equal(errorCaught, true, 'Operation did not revert');
	});

	it('should error when calculating maximum issuance when the currency rate is stale', async function() {
		// Same test as above more or less. Just need to figure out what is going on with assert.revert.
	});

	it('should always return zero maximum issuance if a user is not a whitelisted issuer', async function() {
		const havvens = web3.utils.toBN('321321');
		await havven.transfer(account1, toUnit(havvens), { from: owner });

		await havven.setIssuer(account1, false, { from: owner });
		const maxIssuableNomins = await havven.maxIssuableNomins(account1, nAUD);
		assert.bnEqual(maxIssuableNomins, 0);
	});

	it("should correctly calculate a user's debt balance without prior issuance", async function() {
		await havven.transfer(account1, toUnit('200000'), { from: owner });
		await havven.transfer(account2, toUnit('10000'), { from: owner });

		const debt1 = await havven.debtBalanceOf(account1, web3.utils.asciiToHex('nUSD'));
		const debt2 = await havven.debtBalanceOf(account2, web3.utils.asciiToHex('nUSD'));
		assert.bnEqual(debt1, 0);
		assert.bnEqual(debt2, 0);
	});

	it("should correctly calculate a user's debt balance with prior issuance", async function() {
		// Give some HAV to account1
		await havven.transfer(account1, toUnit('200000'), { from: owner });

		// Make accounts issuers
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		const issuedNomins = toUnit('1001');
		await havven.issueNomins(nUSD, issuedNomins, { from: account1 });

		const debt = await havven.debtBalanceOf(account1, web3.utils.asciiToHex('nUSD'));
		assert.bnEqual(debt, issuedNomins);
	});

	it("should correctly calculate a user's remaining issuable nomins with prior issuance", async function() {
		const hav2usdRate = await exchangeRates.rateForCurrency(HAV);
		const eur2usdRate = await exchangeRates.rateForCurrency(nEUR);
		const hav2eurRate = divideDecimal(hav2usdRate, eur2usdRate);
		const issuanceRatio = await havven.issuanceRatio.call();

		const issuedHavvens = web3.utils.toBN('200012');
		await havven.transfer(account1, toUnit(issuedHavvens), { from: owner });

		// Make account issuer
		await havven.setIssuer(account1, true, { from: owner });

		// Issue
		const nEURIssued = toUnit('2011');
		await havven.issueNomins(nEUR, nEURIssued, { from: account1 });

		const expectedIssuableNomins = multiplyDecimal(
			toUnit(issuedHavvens),
			multiplyDecimal(hav2eurRate, issuanceRatio)
		).sub(nEURIssued);

		const remainingIssuable = await havven.remainingIssuableNomins(account1, nEUR);
		assert.bnEqual(remainingIssuable, expectedIssuableNomins);
	});

	it("should correctly calculate a user's remaining issuable nomins without prior issuance", async function() {
		const hav2usdRate = await exchangeRates.rateForCurrency(HAV);
		const eur2usdRate = await exchangeRates.rateForCurrency(nEUR);
		const hav2eurRate = divideDecimal(hav2usdRate, eur2usdRate);
		const issuanceRatio = await havven.issuanceRatio.call();

		const issuedHavvens = web3.utils.toBN('20');
		await havven.transfer(account1, toUnit(issuedHavvens), { from: owner });

		// Make account issuer
		await havven.setIssuer(account1, true, { from: owner });

		const expectedIssuableNomins = multiplyDecimal(
			toUnit(issuedHavvens),
			multiplyDecimal(hav2eurRate, issuanceRatio)
		);

		const remainingIssuable = await havven.remainingIssuableNomins(account1, nEUR);
		assert.bnEqual(remainingIssuable, expectedIssuableNomins);
	});

	it('should not be able to exceed collatorisation ratio');
	it('should be able to issue more when collatorisation ratio changes');
	it('should be able to read collatorisation ratio for a user');
});
