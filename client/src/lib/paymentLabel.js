/**
 * How a customer's order was paid, in the words on their order history.
 *
 * Three screens used to write `terms ? 'On account' : 'Card'` inline, which
 * called every other method "Card": an order paid at the kiosk's counter, or
 * settled entirely from store credit, told the customer they had used a card.
 */
const LABELS = {
  terms: 'On account',
  counter: 'Pay at the counter',
  'store-credit': 'Store credit',
};

export function orderPaymentLabel(method) {
  return LABELS[method] ?? 'Card';
}

export default orderPaymentLabel;
