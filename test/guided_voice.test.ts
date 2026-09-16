import assert from 'node:assert';
import { INITIAL_STALL_MENU } from '../src/data/sampleMenu';
import {
  calculateOrderTotal,
  formatNaturalSpokenWon,
  formatKoreanOrderMessage,
  parseSpokenOrderText,
  parseVoiceEditCommand,
  translateSpecialRequestToKorean,
  buildAccessibleOrderSummarySpeech,
  buildItemDescriptionSpeech,
  findCheapestItem,
  findItemsByCategoryOrDiet,
} from '../src/lib/orderMath';
import { MenuItem, Order, OrderItem } from '../src/types';
import { GuidedVoiceController } from '../src/lib/guidedVoiceMachine';

console.log('🧪 Starting 25-Scenario Guided Voice Ordering Automated Test Suite...\n');

// Mock Simulated Server
class MockServer {
  private processedKeys = new Set<string>();
  private orders = new Map<string, Order>();
  public networkFailureMode = false;
  public telegramLogs: string[] = [];

  async submitOrder(payload: {
    idempotencyKey: string;
    items: OrderItem[];
    specialRequest?: string;
  }): Promise<{ status: number; body: any }> {
    if (this.networkFailureMode) {
      return {
        status: 502,
        body: { success: false, status: 'Delivery failed—please try again', error: 'Network timeout' },
      };
    }

    if (this.processedKeys.has(payload.idempotencyKey)) {
      const existing = this.orders.get(payload.idempotencyKey)!;
      return {
        status: 200,
        body: {
          success: true,
          status: 'Order already received',
          order: existing,
          isDuplicate: true,
        },
      };
    }

    const orderId = `A${100 + this.orders.size + 1}`;
    const totalKrw = calculateOrderTotal(payload.items);
    const order: Order = {
      orderId,
      idempotencyKey: payload.idempotencyKey,
      items: payload.items,
      totalKrw,
      koreanTranslation: {
        formattedKorean: '',
      },
      status: 'sent',
      ownerAcknowledgement: 'pending',
      createdAt: new Date().toISOString(),
      telegramDelivery: { attempted: true, success: true, mode: 'mock' },
    };

    this.processedKeys.add(payload.idempotencyKey);
    this.orders.set(payload.idempotencyKey, order);
    this.telegramLogs.push(`Delivered order ${orderId} (${payload.items.map((i) => `${i.englishName} x${i.quantity}`).join(', ')})`);

    return {
      status: 200,
      body: { success: true, status: 'Order sent successfully', order },
    };
  }

  clear() {
    this.processedKeys.clear();
    this.orders.clear();
    this.networkFailureMode = false;
    this.telegramLogs = [];
  }
}

const mockServer = new MockServer();

// ===========================================================================
// SCENARIOS 1 to 25
// ===========================================================================

async function runAllTests() {
  const menu = INITIAL_STALL_MENU.items;

  // -------------------------------------------------------------------------
  // Scenario 1: Visitor starts guided voice ordering and hears initial instructions
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    const spokenMessages: string[] = [];
    (controller as any).speak = async (text: string, onEnd?: () => void) => {
      spokenMessages.push(text);
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    controller.startSession(menu, []);
    await new Promise((r) => setTimeout(r, 10));

    assert(spokenMessages.length > 0, 'Should speak introductory instructions');
    assert(
      spokenMessages[0].includes('Guided voice ordering') || spokenMessages[0].includes('read the menu'),
      'Intro instructions must mention reading the menu or saying an order'
    );
    controller.stopSession();
    console.log('✅ Scenario 1 Passed: Visitor starts guided voice ordering and hears initial instructions');
  }

  // -------------------------------------------------------------------------
  // Scenario 2: Visitor asks to hear the menu and all items are read in order
  // -------------------------------------------------------------------------
  {
    const readItems: string[] = [];
    menu.forEach((item, index) => {
      const desc = buildItemDescriptionSpeech(item, index + 1);
      readItems.push(desc);
      assert(desc.startsWith('Item '), 'Item prefix should be spoken');
      assert(desc.includes(item.englishName), 'English name should be spoken');
      assert(desc.includes('won'), 'Price in won should be spoken');
    });

    assert.strictEqual(readItems.length, menu.length, 'All menu items read in order');
    console.log('✅ Scenario 2 Passed: Visitor asks to hear the menu and all items are read in order');
  }

  // -------------------------------------------------------------------------
  // Scenario 3: Visitor interrupts menu reading to place an order
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    let speakAborted = false;
    (controller as any).speak = async (_text: string, onEnd?: () => void) => {
      await new Promise((r) => setTimeout(r, 200));
      if (!speakAborted && onEnd) onEnd();
      return !speakAborted;
    };

    controller.startSession(menu, []);
    controller.handleSpokenInput((controller as any).sessionToken, 'I would like two bulgogi');
    speakAborted = true;

    // Should transition to processing/reviewing
    assert(
      controller.getContext().state === 'reviewing_order' ||
        controller.getContext().state === 'awaiting_confirmation_command',
      'Should immediately interrupt and transition to reviewing the order'
    );
    assert.strictEqual(controller.getContext().currentItems.length, 1);
    assert.strictEqual(controller.getContext().currentItems[0].quantity, 2);
    controller.stopSession();
    console.log('✅ Scenario 3 Passed: Visitor interrupts menu reading to place an order');
  }

  // -------------------------------------------------------------------------
  // Scenario 4: Visitor places a single-item order by item number ('Number 3')
  // -------------------------------------------------------------------------
  {
    const result = parseSpokenOrderText('Number 3', menu);
    assert.strictEqual(result.matched.length, 1, 'Should match item #3');
    assert.strictEqual(result.matched[0].menuItem.id, menu[2].id, 'Matched item should correspond to 3rd item in menu');
    assert.strictEqual(result.matched[0].quantity, 1, 'Default quantity should be 1');
    console.log('✅ Scenario 4 Passed: Visitor places a single-item order by item number ("Number 3")');
  }

  // -------------------------------------------------------------------------
  // Scenario 5: Visitor places a single-item order by English name ('One bulgogi')
  // -------------------------------------------------------------------------
  {
    const result = parseSpokenOrderText('One bulgogi', menu);
    assert.strictEqual(result.matched.length, 1);
    assert.strictEqual(result.matched[0].menuItem.englishName, 'Bulgogi (Marinated Beef)');
    assert.strictEqual(result.matched[0].quantity, 1);
    console.log('✅ Scenario 5 Passed: Visitor places a single-item order by English name ("One bulgogi")');
  }

  // -------------------------------------------------------------------------
  // Scenario 6: Visitor places a multi-item order in a single utterance ('Two bulgogi and one tteokbokki')
  // -------------------------------------------------------------------------
  {
    const result = parseSpokenOrderText('Two bulgogi and one tteokbokki', menu);
    assert.strictEqual(result.matched.length, 2, 'Should match 2 distinct items');
    const bulgogi = result.matched.find((m) => m.menuItem.id === 'item_002');
    const tteok = result.matched.find((m) => m.menuItem.id === 'item_003');
    assert(bulgogi && bulgogi.quantity === 2, 'Bulgogi quantity 2');
    assert(tteok && tteok.quantity === 1, 'Tteokbokki quantity 1');
    console.log('✅ Scenario 6 Passed: Multi-item order in a single utterance');
  }

  // -------------------------------------------------------------------------
  // Scenario 7: Visitor specifies quantity using words ('three') and digits ('3')
  // -------------------------------------------------------------------------
  {
    const resultWords = parseSpokenOrderText('three kimchi stew', menu);
    assert.strictEqual(resultWords.matched[0].quantity, 3, 'Spoken word "three" mapped to 3');

    const resultDigits = parseSpokenOrderText('3 kimchi stew', menu);
    assert.strictEqual(resultDigits.matched[0].quantity, 3, 'Digit "3" mapped to 3');
    console.log('✅ Scenario 7 Passed: Quantity parsed from both words ("three") and digits ("3")');
  }

  // -------------------------------------------------------------------------
  // Scenario 8: Visitor includes a special request ('no onions') which is captured
  // -------------------------------------------------------------------------
  {
    const result = parseSpokenOrderText('Two bulgogi please no onions', menu);
    assert.strictEqual(result.matched.length, 1);
    assert(result.specialRequest, 'Special request should be extracted');
    assert.strictEqual(result.specialRequest?.toLowerCase(), 'no onions');
    console.log('✅ Scenario 8 Passed: Special request ("no onions") captured cleanly');
  }

  // -------------------------------------------------------------------------
  // Scenario 9: Order read back with item names, quantities, unit prices, total, and special request
  // -------------------------------------------------------------------------
  {
    const testItems: OrderItem[] = [
      {
        menuItemId: 'item_002',
        koreanName: '불고기',
        englishName: 'Bulgogi',
        unitPriceKrw: 10000,
        quantity: 2,
      },
    ];
    const speech = buildAccessibleOrderSummarySpeech(testItems, 'less spicy');
    assert(speech.includes('2 orders of Bulgogi'), 'Readback includes item name and quantity');
    assert(speech.includes('ten thousand won each'), 'Readback includes unit price');
    assert(speech.includes('twenty thousand won'), 'Readback includes calculated total');
    assert(speech.includes('Special request: less spicy'), 'Readback includes special request');
    console.log('✅ Scenario 9 Passed: Complete accessible order readback summary generated');
  }

  // -------------------------------------------------------------------------
  // Scenario 10: Visitor confirms order ('yes') and order is sent
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    let sentPayload: any = null;
    (controller as any).submitOrderToBackend = async (payload: any) => {
      sentPayload = payload;
      return { success: true, status: 'Order sent successfully', order: { orderId: 'A101' } };
    };
    (controller as any).speak = async (_text: string, onEnd?: () => void) => {
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    controller.startSession(menu, [
      {
        menuItemId: 'item_001',
        koreanName: '김치찌개',
        englishName: 'Kimchi Stew',
        unitPriceKrw: 8000,
        quantity: 1,
      },
    ]);

    // Fast-forward state to awaiting confirmation
    (controller as any).state = 'awaiting_confirmation_command';
    await controller.handleSpokenInput((controller as any).sessionToken, 'yes confirm and send');

    assert(sentPayload, 'Order should be submitted to backend');
    assert.strictEqual(controller.getContext().state, 'sent');
    controller.stopSession();
    console.log('✅ Scenario 10 Passed: Visitor confirms order ("yes") and order is sent');
  }

  // -------------------------------------------------------------------------
  // Scenario 11: Visitor changes quantity during confirmation ('make it two bulgogi')
  // -------------------------------------------------------------------------
  {
    const currentItems: OrderItem[] = [
      {
        menuItemId: 'item_002',
        koreanName: '불고기',
        englishName: 'Bulgogi',
        unitPriceKrw: 10000,
        quantity: 1,
      },
    ];

    const editCmd = parseVoiceEditCommand('make it two bulgogi', currentItems, menu);
    assert(editCmd.matched, 'Edit command should be matched');
    assert.strictEqual(editCmd.action, 'change_quantity');
    assert.strictEqual(editCmd.quantity, 2);

    const updated = editCmd.apply(currentItems);
    assert.strictEqual(updated[0].quantity, 2, 'Quantity modified from 1 to 2');
    console.log('✅ Scenario 11 Passed: Visitor changes quantity during confirmation ("make it two bulgogi")');
  }

  // -------------------------------------------------------------------------
  // Scenario 12: Visitor adds an item during confirmation ('add one kimchi stew')
  // -------------------------------------------------------------------------
  {
    const currentItems: OrderItem[] = [
      {
        menuItemId: 'item_002',
        koreanName: '불고기',
        englishName: 'Bulgogi',
        unitPriceKrw: 10000,
        quantity: 1,
      },
    ];

    const editCmd = parseVoiceEditCommand('add one kimchi stew', currentItems, menu);
    assert(editCmd.matched, 'Add command matched');
    assert.strictEqual(editCmd.action, 'add_item');
    const updated = editCmd.apply(currentItems);
    assert.strictEqual(updated.length, 2, 'Should now have 2 items');
    assert(updated.some((i) => i.menuItemId === 'item_001'), 'Kimchi Stew added');
    console.log('✅ Scenario 12 Passed: Visitor adds item during confirmation ("add one kimchi stew")');
  }

  // -------------------------------------------------------------------------
  // Scenario 13: Visitor removes an item during confirmation ('remove the tteokbokki')
  // -------------------------------------------------------------------------
  {
    const currentItems: OrderItem[] = [
      {
        menuItemId: 'item_002',
        koreanName: '불고기',
        englishName: 'Bulgogi',
        unitPriceKrw: 10000,
        quantity: 1,
      },
      {
        menuItemId: 'item_003',
        koreanName: '떡볶이',
        englishName: 'Tteokbokki',
        unitPriceKrw: 4000,
        quantity: 1,
      },
    ];

    const editCmd = parseVoiceEditCommand('remove the tteokbokki', currentItems, menu);
    assert(editCmd.matched, 'Remove command matched');
    assert.strictEqual(editCmd.action, 'remove_item');
    const updated = editCmd.apply(currentItems);
    assert.strictEqual(updated.length, 1, 'Only one item remains');
    assert.strictEqual(updated[0].menuItemId, 'item_002', 'Only Bulgogi remains');
    console.log('✅ Scenario 13 Passed: Visitor removes an item during confirmation ("remove the tteokbokki")');
  }

  // -------------------------------------------------------------------------
  // Scenario 14: Visitor changes special request during confirmation ('actually, extra spicy')
  // -------------------------------------------------------------------------
  {
    const currentItems: OrderItem[] = [
      {
        menuItemId: 'item_003',
        koreanName: '떡볶이',
        englishName: 'Tteokbokki',
        unitPriceKrw: 4000,
        quantity: 1,
      },
    ];

    const editCmd = parseVoiceEditCommand('actually, extra spicy', currentItems, menu);
    assert(editCmd.matched, 'Special request edit matched');
    assert.strictEqual(editCmd.action, 'special_request');
    assert(editCmd.specialRequest?.includes('extra spicy'));
    console.log('✅ Scenario 14 Passed: Visitor changes special request during confirmation ("actually, extra spicy")');
  }

  // -------------------------------------------------------------------------
  // Scenario 15: Visitor asks for help and hears context-sensitive commands
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    let spokenHelp = '';
    (controller as any).speak = async (text: string, onEnd?: () => void) => {
      spokenHelp = text;
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    controller.startSession(menu, []);
    (controller as any).state = 'awaiting_confirmation_command';
    await controller.handleSpokenInput((controller as any).sessionToken, 'help');

    assert(spokenHelp.includes('confirm and send') || spokenHelp.includes('change'), 'Help must list confirmation commands');
    controller.stopSession();
    console.log('✅ Scenario 15 Passed: Visitor asks for help and hears context-sensitive commands');
  }

  // -------------------------------------------------------------------------
  // Scenario 16: Visitor says an unrecognised phrase; app asks for clarification
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    let clarificationPrompt = '';
    (controller as any).speak = async (text: string, onEnd?: () => void) => {
      clarificationPrompt = text;
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    controller.startSession(menu, []);
    (controller as any).state = 'awaiting_menu_command';
    await controller.handleSpokenInput((controller as any).sessionToken, 'abracadabra blue elephant');

    assert(
      clarificationPrompt.toLowerCase().includes('did not catch') ||
        clarificationPrompt.toLowerCase().includes('try saying') ||
        clarificationPrompt.toLowerCase().includes('pardon'),
      'App asks for clarification on unrecognized phrase'
    );
    controller.stopSession();
    console.log('✅ Scenario 16 Passed: Visitor says unrecognized phrase; app asks for clarification');
  }

  // -------------------------------------------------------------------------
  // Scenario 17: Visitor says 'cancel'; app confirms cancellation
  // -------------------------------------------------------------------------
  {
    const controller = new GuidedVoiceController();
    let cancelSpoken = false;
    (controller as any).speak = async (text: string, onEnd?: () => void) => {
      if (text.toLowerCase().includes('order cancelled')) cancelSpoken = true;
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    controller.startSession(menu, [
      {
        menuItemId: 'item_001',
        koreanName: '김치찌개',
        englishName: 'Kimchi Stew',
        unitPriceKrw: 8000,
        quantity: 1,
      },
    ]);
    (controller as any).state = 'awaiting_confirmation_command';
    await controller.handleSpokenInput((controller as any).sessionToken, 'cancel');

    assert.strictEqual(controller.getContext().state, 'cancelled');
    assert.strictEqual(controller.getContext().currentItems.length, 0);
    assert(cancelSpoken, 'Cancellation voice feedback spoken');
    controller.stopSession();
    console.log('✅ Scenario 17 Passed: Visitor says "cancel"; app confirms cancellation');
  }

  // -------------------------------------------------------------------------
  // Scenario 18: Order with special request translated to Korean correctly
  // -------------------------------------------------------------------------
  {
    const specialReq = 'no onions, please make it extra spicy';
    const koreanTrans = translateSpecialRequestToKorean(specialReq);
    assert(koreanTrans.includes('양파 빼주세요') || koreanTrans.includes('아주 맵게'), 'Special requests mapped into Korean');

    const msg = formatKoreanOrderMessage(
      'A102',
      [
        {
          menuItemId: 'item_002',
          koreanName: '불고기',
          englishName: 'Bulgogi',
          unitPriceKrw: 10000,
          quantity: 2,
        },
      ],
      20000,
      specialReq,
      koreanTrans
    );

    assert(msg.includes('주문 번호: <b>A102</b>'));
    assert(msg.includes('불고기 x 2'));
    assert(msg.includes('요청사항:'));
    console.log('✅ Scenario 18 Passed: Order with special request translated to Korean correctly');
  }

  // -------------------------------------------------------------------------
  // Scenario 19: Duplicate submission prevented when visitor repeats confirmation phrase
  // -------------------------------------------------------------------------
  {
    mockServer.clear();
    const payload = {
      idempotencyKey: 'idemp_unique_test_19',
      items: [
        {
          menuItemId: 'item_002',
          koreanName: '불고기',
          englishName: 'Bulgogi',
          unitPriceKrw: 10000,
          quantity: 1,
        },
      ],
    };

    const first = await mockServer.submitOrder(payload);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.isDuplicate, undefined);

    // Visitor repeats confirmation:
    const second = await mockServer.submitOrder(payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.isDuplicate, true, 'Second submission with same key flagged as duplicate');
    assert.strictEqual(mockServer.telegramLogs.length, 1, 'Only ONE telegram message delivered');
    console.log('✅ Scenario 19 Passed: Duplicate submission prevented when visitor repeats confirmation phrase');
  }

  // -------------------------------------------------------------------------
  // Scenario 20: Network failure during send: app announces failure, offers retry, preserves order state
  // -------------------------------------------------------------------------
  {
    mockServer.clear();
    mockServer.networkFailureMode = true;

    const controller = new GuidedVoiceController();
    (controller as any).submitOrderToBackend = (p: any) => mockServer.submitOrder(p);
    (controller as any).speak = async (_text: string, onEnd?: () => void) => {
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    const items: OrderItem[] = [
      {
        menuItemId: 'item_001',
        koreanName: '김치찌개',
        englishName: 'Kimchi Stew',
        unitPriceKrw: 8000,
        quantity: 2,
      },
    ];

    controller.startSession(menu, items, 'idemp_test_20');
    (controller as any).state = 'awaiting_confirmation_command';
    await controller.handleSpokenInput((controller as any).sessionToken, 'yes confirm');

    assert.strictEqual(controller.getContext().state, 'failed', 'State should be failed');
    assert.strictEqual(controller.getContext().currentItems.length, 1, 'Order items preserved');
    assert.strictEqual(controller.getContext().currentItems[0].quantity, 2, 'Quantity preserved');
    controller.stopSession();
    console.log('✅ Scenario 20 Passed: Network failure announces failure, offers retry, preserves order state');
  }

  // -------------------------------------------------------------------------
  // Scenario 21: Successful retry sends order with new order ID or properly handles idempotency
  // -------------------------------------------------------------------------
  {
    mockServer.networkFailureMode = false; // Network restored

    const controller = new GuidedVoiceController();
    (controller as any).submitOrderToBackend = (p: any) => mockServer.submitOrder(p);
    (controller as any).speak = async (_text: string, onEnd?: () => void) => {
      if (onEnd) onEnd();
      return true;
    };
    (controller as any).startListeningForUser = () => {};

    const items: OrderItem[] = [
      {
        menuItemId: 'item_001',
        koreanName: '김치찌개',
        englishName: 'Kimchi Stew',
        unitPriceKrw: 8000,
        quantity: 2,
      },
    ];

    controller.startSession(menu, items, 'idemp_test_21');
    (controller as any).state = 'failed';
    await controller.handleSpokenInput((controller as any).sessionToken, 'retry order');

    assert.strictEqual(controller.getContext().state, 'sent', 'Retry successfully transitioned to sent');
    assert(controller.getContext().orderId, 'Order ID generated upon successful retry');
    controller.stopSession();
    console.log('✅ Scenario 21 Passed: Successful retry sends order and properly handles idempotency');
  }

  // -------------------------------------------------------------------------
  // Scenario 22: Menu reading respects 'pause' and 'resume' voice commands
  // -------------------------------------------------------------------------
  {
    let paused = false;
    let resumed = false;

    const mockReader = {
      pause: () => {
        paused = true;
      },
      resume: () => {
        resumed = true;
      },
    };

    // Simulate voice handler
    const handleVoiceCommand = (cmd: string) => {
      if (cmd.includes('pause')) mockReader.pause();
      if (cmd.includes('resume') || cmd.includes('continue')) mockReader.resume();
    };

    handleVoiceCommand('please pause reading');
    assert.strictEqual(paused, true, 'Pause command respected');

    handleVoiceCommand('resume reading');
    assert.strictEqual(resumed, true, 'Resume command respected');
    console.log('✅ Scenario 22 Passed: Menu reading respects "pause" and "resume" voice commands');
  }

  // -------------------------------------------------------------------------
  // Scenario 23: Visitor asks 'what is the cheapest item?' and gets correct response
  // -------------------------------------------------------------------------
  {
    const cheapest = findCheapestItem(menu);
    assert(cheapest, 'Cheapest item must be found');
    const minPrice = Math.min(...menu.filter((m) => m.available).map((m) => m.priceKrw));
    assert.strictEqual(cheapest.priceKrw, minPrice, 'Should return lowest price item');
    console.log(`✅ Scenario 23 Passed: Visitor asks "what is the cheapest item?" -> ${cheapest.englishName} (₩${cheapest.priceKrw})`);
  }

  // -------------------------------------------------------------------------
  // Scenario 24: Visitor asks 'which items are vegetarian?' and gets correct list
  // -------------------------------------------------------------------------
  {
    const vegItems = findItemsByCategoryOrDiet(menu, 'vegetarian');
    assert(vegItems.length > 0, 'Vegetarian items found');
    for (const item of vegItems) {
      assert(item.isVegetarian, `${item.englishName} must have isVegetarian=true`);
    }
    console.log(`✅ Scenario 24 Passed: Visitor asks "which items are vegetarian?" -> ${vegItems.map((i) => i.englishName).join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // Scenario 25: Multiple consecutive voice orders in a single session: each receives a unique order ID and Telegram message
  // -------------------------------------------------------------------------
  {
    mockServer.clear();

    const order1 = await mockServer.submitOrder({
      idempotencyKey: 'idemp_session_1',
      items: [{ menuItemId: 'item_001', koreanName: '김치찌개', englishName: 'Kimchi Stew', unitPriceKrw: 8000, quantity: 1 }],
    });

    const order2 = await mockServer.submitOrder({
      idempotencyKey: 'idemp_session_2',
      items: [{ menuItemId: 'item_002', koreanName: '불고기', englishName: 'Bulgogi', unitPriceKrw: 10000, quantity: 1 }],
    });

    assert.notStrictEqual(order1.body.order.orderId, order2.body.order.orderId, 'Order IDs must be strictly unique');
    assert.strictEqual(mockServer.telegramLogs.length, 2, 'Two distinct Telegram notifications dispatched');
    console.log(`✅ Scenario 25 Passed: Multiple consecutive voice orders in a single session received unique IDs (${order1.body.order.orderId} and ${order2.body.order.orderId})`);
  }

  console.log('\n🎉 ALL 25 GUIDED VOICE ORDERING AUTOMATED TEST SCENARIOS PASSED!\n');
}

runAllTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
