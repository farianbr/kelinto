import KioskOptionGrid from './KioskOptionGrid';

/**
 * "Find your model": the three device questions, shared by the repair and the
 * sell flows.
 *
 * Each level's answers are the children of what was chosen above it, so the
 * tablet can never offer a combination the business does not take in. The tree
 * has four levels (category, brand, series, model) and only three are asked:
 * a customer does not know whether their handset is filed under "iPhone 15" or
 * "iPhone 15 Pro", and being asked would be a question about our filing rather
 * than their device. Every model under the brand is offered at once and the
 * series is inferred from the one they pick.
 *
 * A level the business has not built is typed instead, which is why each step
 * is valid either when it was tapped or when something was typed.
 */
export function deviceSteps(tree = []) {
  const categoryNode = (answers) => tree.find((node) => node.name === answers.category);
  const brandNode = (answers) =>
    categoryNode(answers)?.children.find((node) => node.name === answers.brand);
  const models = (answers) =>
    (brandNode(answers)?.children ?? []).flatMap((series) =>
      (series.children ?? []).map((model) => ({ name: model.name, series: series.name })),
    );

  const typed = (key) => (answers) => Boolean(String(answers[key] ?? '').trim());

  return [
    {
      key: 'category',
      prompt: 'What kind of device is it?',
      valid: typed('category'),
      footer: tree.length ? 'none' : 'next',
      render: ({ answers, next, set }) => (
        <KioskOptionGrid
          options={tree.map((node) => node.name)}
          onChoose={(name) => next({ category: name, brand: '', series: '', model: '' })}
          typedValue={answers.category}
          onType={(value) => set('category', value)}
        />
      ),
    },
    {
      key: 'brand',
      prompt: 'Which brand?',
      valid: typed('brand'),
      footer: (answers) => ((categoryNode(answers)?.children ?? []).length ? 'none' : 'next'),
      render: ({ answers, next, set }) => (
        <KioskOptionGrid
          options={(categoryNode(answers)?.children ?? []).map((node) => node.name)}
          onChoose={(name) => next({ brand: name, series: '', model: '' })}
          typedValue={answers.brand}
          onType={(value) => set('brand', value)}
        />
      ),
    },
    {
      key: 'model',
      prompt: 'Which model?',
      hint: 'Pick the closest. Our team will confirm it.',
      valid: typed('model'),
      footer: (answers) => (models(answers).length ? 'none' : 'next'),
      render: ({ answers, next, set }) => {
        const list = models(answers);
        return (
          <KioskOptionGrid
            options={list.map((model) => model.name)}
            onChoose={(name) =>
              next({ model: name, series: list.find((model) => model.name === name)?.series ?? '' })
            }
            typedValue={answers.model}
            onType={(value) => set('model', value)}
          />
        );
      },
    },
  ];
}

export default deviceSteps;
