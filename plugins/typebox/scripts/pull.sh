if [ -d "typebox-codegen" ]; then
  cd typebox-codegen
  git fetch origin main
  git reset --hard origin/main
else
  git clone https://github.com/sinclairzx81/typebox-codegen.git --depth 1 --single-branch
  cd typebox-codegen
fi

OUT_DIR=../src/typebox-codegen

mkdir -p $OUT_DIR/typescript
mkdir -p $OUT_DIR/common
cp src/typescript/typescript-to-typebox.ts $OUT_DIR/typescript/generator.ts
cp src/common/jsdoc.ts $OUT_DIR/common/jsdoc.ts
cp license $OUT_DIR/LICENSE
